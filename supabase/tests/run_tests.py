"""Runs the real schema in a real Postgres and tries hard to break the stock rules."""
import os, sys, threading, uuid, warnings, subprocess
warnings.filterwarnings("ignore")
import psycopg
from psycopg.types.json import Jsonb

HERE = os.path.dirname(os.path.abspath(__file__)); SQL = os.path.dirname(HERE)
BASE = os.environ.get("PG_BASE", "postgresql://postgres@127.0.0.1:54329")
DB = "florenti_test_" + uuid.uuid4().hex[:8]
with psycopg.connect(BASE + "/postgres", autocommit=True) as c: c.execute(f"create database {DB}")
URI = f"{BASE}/{DB}"
fails = []
def check(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else f"   <-- {extra}"))
    if not cond: fails.append(name)

def run_file(p):
    with psycopg.connect(URI, autocommit=True) as c: c.execute(open(p).read())
for f in (os.path.join(HERE, "stub_supabase.sql"), os.path.join(SQL, "001_schema.sql"), os.path.join(SQL, "002_seed.sql"), os.path.join(SQL, "003_offer_admin.sql")): run_file(f)

def sess(role=None, uid=None):
    c = psycopg.connect(URI)
    if role: c.execute(f"set role {role}")
    if uid: c.execute("select set_config('request.jwt.claim.sub', %s, false)", [uid])
    c.commit(); return c
def attempt(c, sql, params=()):
    try:
        cur = c.execute(sql, params); rows = cur.fetchall() if cur.description else None; c.commit(); return ("ok", rows)
    except psycopg.errors.Error as e:
        c.rollback(); return ("err", e.diag.message_primary, e.diag.message_detail)

su = psycopg.connect(URI, autocommit=True)
ADMIN, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
for u in (ADMIN, OTHER): su.execute("insert into auth.users(id) values (%s)", [u])
su.execute("insert into admin_users(user_id) values (%s)", [ADMIN])
admin, other, anon = sess("authenticated", ADMIN), sess("authenticated", OTHER), sess("anon")

OFFER = su.execute("select id from offers").fetchone()[0]; CUR = [OFFER]
SC = su.execute("select name,id from scents order by name limit 8").fetchall()
ids = {n: i for n, i in SC}; N = [n for n, _ in SC]
A, B, C, D, E, F, G, X = N          # X is deliberately NOT in the offer
for n in N[:7]: su.execute("insert into offer_scents values (%s,%s)", [OFFER, ids[n]])
def stock(): return dict(su.execute("select name, stock_ml from scents where name = any(%s)", [N]).fetchall())
def setstock(name, target):
    cur = su.execute("select stock_ml from scents where id=%s", [ids[name]]).fetchone()[0]
    if target != cur: attempt(admin, "select adjust_stock(%s,%s,'correction','test setup')", [ids[name], target - cur])
for n, ml in zip(N, [100, 50, 10, 15, 5, 0, 700, 100]): setstock(n, ml)
def order(items, name="Test Customer", email="t@example.com", phone="", notes="", conn=None):
    js = Jsonb(items) if not isinstance(items, str) else items
    return attempt(conn or anon, "select * from place_order(%s,%s,%s,%s,%s,%s)", [CUR[0], name, email, phone, notes, js])
line = lambda n, q: {"scent_id": str(ids[n]), "quantity": q}
n_orders = lambda: su.execute("select count(*) from orders").fetchone()[0]

print("\n== 1. Visitors can see only what they should")
check("anon cannot read scents table", attempt(anon, "select * from scents")[0] == "err")
check("anon cannot read orders table", attempt(anon, "select * from orders")[0] == "err")
check("anon cannot read inventory movements", attempt(anon, "select * from inventory_movements")[0] == "err")
cur = anon.execute("select * from public_offer_scents"); cols = [d.name for d in cur.description]; rows = cur.fetchall(); anon.commit()
check("offer view exposes no stock_ml column", "stock_ml" not in cols, cols)
mb = {r[cols.index("name")]: r[cols.index("max_bars")] for r in rows}
check("offer view hides 0 ml scent", F not in mb)
check("offer view caps max_bars at box size (100ml shows 10, not 20)", mb[A] == 10 and mb[G] == 10 and mb[B] == 10, mb)
check("offer view max_bars right for small stock (10ml=2, 15ml=3, 5ml=1)", (mb[C], mb[D], mb[E]) == (2, 3, 1), mb)
check("scent not in offer is not offerable", X not in mb)
pub = {r[0] for r in anon.execute("select name from public_scents").fetchall()}; anon.commit()
check("main list hides the 0 ml scent only", F not in pub and len(pub) == 149 and E in pub, len(pub))

print("\n== 2. Placing an order")
before = stock(); r = order([line(A, 4), line(B, 3), line(C, 2), line(D, 1)])
check("valid 10-bar order accepted", r[0] == "ok", r); ref1 = r[1][0][1] if r[0] == "ok" else None; oid1 = r[1][0][0] if r[0] == "ok" else None
check("order gets a reference number", ref1 == "FLO-1001", ref1)
after = stock()
check("5 ml deducted per bar (A -20, B -15, C -10, D -5)", (before[A]-after[A], before[B]-after[B], before[C]-after[C], before[D]-after[D]) == (20, 15, 10, 5), after)
check("movements recorded for each scent", su.execute("select count(*) from inventory_movements where order_id=%s and reason='order'", [oid1]).fetchone()[0] == 4)
check("scent drained to 0 vanishes from offer list", C not in {x[0] for x in anon.execute("select name from public_offer_scents").fetchall()}); anon.commit()
check("scent drained to 0 vanishes from main list", C not in {x[0] for x in anon.execute("select name from public_scents").fetchall()}); anon.commit()
check("order saved as 'new' with price", su.execute("select status,total_pence from orders where id=%s", [oid1]).fetchone() == ("new", 2000))

print("\n== 3. Bad orders are rejected and change nothing")
snap, cnt = stock(), n_orders()
bad = {
 "9 bars": ([line(A, 9)], {}), "11 bars": ([line(A, 11)], {}), "empty basket": ([], {}),
 "scent not in this month's offer": ([line(X, 5), line(A, 5)], {}),
 "zero quantity line": ([line(A, 0), line(B, 10)], {}), "negative quantity": ([line(A, 11), line(B, -1)], {}),
 "scent with 0 stock": ([line(F, 1), line(A, 9)], {}), "unknown scent id": ([{"scent_id": str(uuid.uuid4()), "quantity": 10}], {}),
 "garbage scent id": ([{"scent_id": "abc", "quantity": 10}], {}), "missing name": ([line(A, 10)], {"name": " "}),
 "bad email": ([line(A, 10)], {"email": "nope"}), "no contact details": ([line(A, 10)], {"email": "", "phone": ""}),
 "not a list": ("{\"scent_id\": 1}", {}),
}
for label, (items, kw) in bad.items():
    res = order(items, **kw); check(f"rejected: {label}", res[0] == "err", res)
check("no stock changed by any bad order", stock() == snap)
check("no order rows created by bad orders", n_orders() == cnt)
res = order([line(A, 5), line(A, 5)]); check("duplicate lines for same scent are merged", res[0] == "ok", res)
setstock(A, 100); setstock(E, 5); snap = stock()
res = order([line(E, 3), line(A, 7)]); check("ordering more than stock is blocked (E has 5ml, wants 15)", res[0] == "err" and res[1] == "insufficient_stock" and res[2] == E, res)
check("...and the other scent in that order was NOT deducted (atomic)", stock() == snap, stock())

print("\n== 4. Running low")
setstock(D, 15); setstock(A, 100)
res = order([line(D, 3), line(A, 7)]); check("can take the last bars of a scent", res[0] == "ok", res)
check("15 ml - 3 bars = 0 ml, hidden everywhere", D not in {x[0] for x in anon.execute("select name from public_scents").fetchall()}); anon.commit()
setstock(E, 5); res = order([line(E, 1), line(A, 9)])
check("5 ml scent allows exactly 1 bar then disappears", res[0] == "ok" and stock()[E] == 0)

print("\n== 5. Many customers at once (real concurrent connections)")
def blast(jobs):
    out = [None] * len(jobs); bar = threading.Barrier(len(jobs))
    def w(i):
        c = sess("anon"); bar.wait(); out[i] = order(jobs[i], conn=c); c.close()
    ts = [threading.Thread(target=w, args=(i,)) for i in range(len(jobs))]
    [t.start() for t in ts]; [t.join() for t in ts]; return out
setstock(A, 100); cnt = n_orders()
outs = blast([[line(A, 10)] for _ in range(8)])
ok = [o for o in outs if o[0] == "ok"]
check("8 simultaneous orders for 20 bars of stock: exactly 2 succeed", len(ok) == 2, [o[0] for o in outs])
check("the losers got a clean 'insufficient_stock'", all(o[1] == "insufficient_stock" for o in outs if o[0] == "err"), outs)
check("stock ended at exactly 0, never negative", stock()[A] == 0)
check("exactly 2 order rows were created", n_orders() == cnt + 2)
setstock(A, 200); setstock(B, 200)
jobs = [([line(A, 5), line(B, 5)] if i % 2 else [line(B, 5), line(A, 5)]) for i in range(12)]
outs = blast(jobs); ok = [o for o in outs if o[0] == "ok"]
check("12 simultaneous orders touching the same two scents in opposite orders: no deadlocks", all(o[0] == "ok" or o[1] == "insufficient_stock" for o in outs), [o for o in outs if o[0] == "err"][:2])
check("exactly 8 fit in 200 ml each, 4 are refused", len(ok) == 8, len(ok))
check("both scents ended at exactly 0", stock()[A] == 0 and stock()[B] == 0, stock())

print("\n== 6. Cancelling and restoring stock")
items = su.execute("select s.name, i.quantity*i.ml_per_bar from order_items i join scents s on s.id=i.scent_id where order_id=%s", [oid1]).fetchall()
before = stock(); res = attempt(admin, "select cancel_order(%s,'customer changed mind')", [oid1])
check("admin can cancel an order", res == ("ok", [(True,)]), res)
after = stock(); check("every scent got its oil back", all(after[n] - before[n] == ml for n, ml in items), (items, before, after))
check("order marked cancelled with restock time", su.execute("select status, restocked_at is not null from orders where id=%s", [oid1]).fetchone() == ("cancelled", True))
res = attempt(admin, "select cancel_order(%s)", [oid1]); snap = stock()
check("cancelling again does nothing (returns false)", res == ("ok", [(False,)]), res)
check("...and stock is unchanged (restored exactly once)", stock() == snap == after)
setstock(A, 100); setstock(B, 100); r2 = order([line(A, 5), line(B, 5)]); oid2 = r2[1][0][0]; before = stock()
outs = [None, None]; bar = threading.Barrier(2); cs = [sess("authenticated", ADMIN) for _ in range(2)]
def cw(i): bar.wait(); outs[i] = attempt(cs[i], "select cancel_order(%s)", [oid2])
ts = [threading.Thread(target=cw, args=(i,)) for i in range(2)]; [t.start() for t in ts]; [t.join() for t in ts]
check("two admins cancelling the same order at once: one wins, one no-ops", sorted(o[1][0][0] for o in outs) == [False, True], outs)
check("stock restored exactly once (+25 each)", stock()[A] - before[A] == 25 and stock()[B] - before[B] == 25, (before, stock()))
check("DB itself refuses a duplicate restore entry", attempt(su, "insert into inventory_movements(scent_id,delta_ml,reason,order_id) select scent_id,5,'order_cancelled',order_id from order_items where order_id=%s limit 1", [oid2])[0] == "err")
check("normal user cannot cancel orders", attempt(other, "select cancel_order(%s)", [oid2])[1:2] == ("not_authorised",))
check("visitor cannot cancel orders", attempt(anon, "select cancel_order(%s)", [oid2])[0] == "err")
r3 = order([line(A, 10)]); oid3 = r3[1][0][0]
check("status flow new > paid > making > completed", all(attempt(admin, "select set_order_status(%s,%s)", [oid3, s])[0] == "ok" for s in ("paid", "making", "completed")))
check("cancelled orders cannot be reopened", attempt(admin, "select set_order_status(%s,'paid')", [oid2])[1:2] == ("order_cancelled",))
check("setting status to cancelled restores stock too", attempt(admin, "select set_order_status(%s,'cancelled')", [oid3])[0] == "ok" and stock()[A] >= 95)

print("\n== 7. Admin stock controls")
setstock(B, 20)
check("add stock", attempt(admin, "select adjust_stock(%s,50,'manual_add','new oil')", [ids[B]]) == ("ok", [(70,)]))
check("record a fair sale (remove stock)", attempt(admin, "select adjust_stock(%s,-30,'fair','market stall')", [ids[B]]) == ("ok", [(40,)]))
check("cannot remove more than exists", attempt(admin, "select adjust_stock(%s,-999,'fair')", [ids[B]])[1] == "insufficient_stock")
check("bad reason rejected", attempt(admin, "select adjust_stock(%s,5,'because')", [ids[B]])[1] == "invalid_reason")
check("normal user cannot adjust stock", attempt(other, "select adjust_stock(%s,5,'manual_add')", [ids[B]])[1] == "not_authorised")
check("even an admin cannot edit stock_ml directly (keeps the audit trail honest)", attempt(admin, "update scents set stock_ml=999 where id=%s", [ids[B]])[1] == "stock_must_use_function")
check("admin can edit names/descriptions", attempt(admin, "update scents set description='edited' where id=%s returning description", [ids[B]]) == ("ok", [("edited",)]))
check("normal user's edits change nothing (blocked by policy)", attempt(other, "update scents set description='hacked' where id=%s returning 1", [ids[B]]) == ("ok", []))
check("admin can add a brand-new scent then give it stock", attempt(admin, "insert into scents(name) values ('Brand New Scent') returning id")[0] == "ok")
nid = su.execute("select id from scents where name='Brand New Scent'").fetchone()[0]
check("new scent hidden until stocked", "Brand New Scent" not in {x[0] for x in anon.execute("select name from public_scents").fetchall()}); anon.commit()
attempt(admin, "select adjust_stock(%s,100,'manual_add','first batch')", [nid])
check("...then appears on the public list", "Brand New Scent" in {x[0] for x in anon.execute("select name from public_scents").fetchall()}); anon.commit()
check("normal user sees no orders", attempt(other, "select * from orders") == ("ok", []))
check("admin sees orders", len(attempt(admin, "select * from orders")[1]) > 5)

print("\n== 9. Monthly offers (November > December)")
setstock(A, 100); setstock(B, 100); setstock(C, 0); setstock(D, 100)
check("non-admin cannot create offers", attempt(other, "select save_offer(null,'Hack',10,2000,5,%s,true)", [[ids[A]]])[1] == "not_authorised")
check("visitor cannot create offers", attempt(anon, "select save_offer(null,'Hack',10,2000,5,%s,true)", [[ids[A]]])[0] == "err")
res = attempt(admin, "select save_offer(null,'December Selection Box',10,2200,5,%s,false)", [[ids[A], ids[C], ids[D]]]); DEC = res[1][0][0]; CUR[0] = DEC
check("admin can build next month's offer without switching it on", res[0] == "ok" and len(attempt(anon, "select * from public_offers")[1]) == 1)
check("two live offers are impossible (database enforces it)", attempt(su, "update offers set active=true where id=%s", [DEC])[0] == "err")
nov_orders = n_orders()
check("switching December on switches November off", attempt(admin, "select set_offer_active(%s,true)", [DEC])[0] == "ok" and [r[1] for r in attempt(anon, "select * from public_offers")[1]] == ["December Selection Box"])
dec = {r[0] for r in attempt(anon, "select name from public_offer_scents")[1]}
check("December list shows its in-stock scents only (C is at 0 so it's hidden)", dec == {A, D}, dec)
check("scents not picked for December are not orderable", order([line(B, 10)])[1] == "scent_unavailable")
check("old November orders are untouched", n_orders() == nov_orders and su.execute("select count(*) from orders where offer_id=%s", [OFFER]).fetchone()[0] > 0)
res = order([line(A, 4), line(D, 6)]); check("ordering from December works at the December price", res[0] == "ok" and res[1][0][2] == 2200, res)
res = attempt(admin, "select save_offer(%s,'December Selection Box',10,2200,5,%s,false)", [DEC, [ids[A]]])
check("editing the live offer's scent list removes scents from it", res[0] == "ok" and {r[0] for r in attempt(anon, "select name from public_offer_scents")[1]} == {A})
check("ending an offer leaves no offer to order from", attempt(admin, "select set_offer_active(%s,false)", [DEC])[0] == "ok" and attempt(anon, "select * from public_offers")[1] == [] and order([line(A, 10)])[1] == "offer_unavailable")
check("bad offer details rejected", all(attempt(admin, "select save_offer(null,%s,%s,%s,%s,'{}',false)", a)[0] == "err" for a in (["", 10, 2000, 5], ["x", 0, 2000, 5], ["x", 10, -1, 5], ["x", 10, 2000, 0])))

print("\n== 8. The books always balance")
bad_rows = su.execute("select s.name, s.stock_ml, coalesce(sum(m.delta_ml),0) from scents s left join inventory_movements m on m.scent_id=s.id group by s.id having s.stock_ml <> coalesce(sum(m.delta_ml),0) or s.stock_ml < 0").fetchall()
check("for every scent, stock = sum of every movement, and never negative", not bad_rows, bad_rows[:3])
print(f"\n{'ALL TESTS PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
su.close()
with psycopg.connect(BASE + "/postgres", autocommit=True) as c:
    c.execute(f"drop database {DB} with (force)")
sys.exit(1 if fails else 0)
