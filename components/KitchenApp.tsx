"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProductList from "./ProductList";

type Household = { id: string; name: string; invite_code: string; created_by: string };
type Member = { user_id: string; role: string };
type Product = { id: string; name: string; quantity: number | null; unit: string | null; category: string | null; expiry_date: string | null };
type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; done: boolean };
type Tab = "products" | "shopping";

const UNITS = ["шт.", "г", "кг", "мл", "л", "уп.", "пач."];
const CATEGORIES = ["Овощи", "Фрукты", "Мясо", "Молочные", "Бакалея", "Напитки", "Другое"];

export default function KitchenApp() {
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Все");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [householdName, setHouseholdName] = useState("Наша кухня");
  const [inviteCode, setInviteCode] = useState("");
  const [productName, setProductName] = useState("");
  const [productQuantity, setProductQuantity] = useState("");
  const [productUnit, setProductUnit] = useState("шт.");
  const [productCategory, setProductCategory] = useState("Другое");
  const [productExpiry, setProductExpiry] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [shoppingName, setShoppingName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadProducts(householdId: string) {
    const { data, error } = await supabase.from("products").select("id, name, quantity, unit, category, expiry_date").eq("household_id", householdId).order("expiry_date", { ascending: true, nullsFirst: false }).order("name", { ascending: true });
    if (!error) setProducts(data ?? []);
  }

  async function loadShopping(householdId: string) {
    const { data, error } = await supabase.from("shopping_items").select("id, name, quantity, unit, done").eq("household_id", householdId).order("done", { ascending: true }).order("name", { ascending: true });
    if (!error) setShopping(data ?? []);
  }

  async function loadKitchen() {
    setLoading(true); setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id); setUserEmail(user.email ?? "");
      const { data: membership, error: membershipError } = await supabase.from("household_members").select("household_id, user_id, role").eq("user_id", user.id).limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { setHousehold(null); setMembers([]); setProducts([]); setShopping([]); return; }
      const [h, m, p, s] = await Promise.all([
        supabase.from("households").select("id, name, invite_code, created_by").eq("id", membership.household_id).single(),
        supabase.from("household_members").select("user_id, role").eq("household_id", membership.household_id),
        supabase.from("products").select("id, name, quantity, unit, category, expiry_date").eq("household_id", membership.household_id).order("expiry_date", { ascending: true, nullsFirst: false }).order("name", { ascending: true }),
        supabase.from("shopping_items").select("id, name, quantity, unit, done").eq("household_id", membership.household_id).order("done", { ascending: true }).order("name", { ascending: true }),
      ]);
      if (h.error) throw h.error; if (m.error) throw m.error; if (p.error) throw p.error; if (s.error) throw s.error;
      setHousehold(h.data); setMembers(m.data ?? []); setProducts(p.data ?? []); setShopping(s.data ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить кухню."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadKitchen(); }, []);

  useEffect(() => {
    if (!household?.id) return;
    const channel = supabase.channel(`kitchen:${household.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `household_id=eq.${household.id}` }, () => loadProducts(household.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items", filter: `household_id=eq.${household.id}` }, () => loadShopping(household.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [household?.id]);

  async function createKitchen() {
    setActionLoading(true); setError("");
    try { const { data, error } = await supabase.rpc("create_household", { household_name: householdName.trim() || "Наша кухня" }); if (error) throw error; setHousehold(data); setMembers([{ user_id: data.created_by, role: "owner" }]); setProducts([]); setShopping([]); setMessage("Кухня создана!"); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось создать кухню."); } finally { setActionLoading(false); }
  }

  async function joinKitchen() {
    if (!inviteCode.trim()) { setError("Введите код приглашения."); return; }
    setActionLoading(true); setError("");
    try { const { error } = await supabase.rpc("join_household", { code: inviteCode.trim() }); if (error) throw error; setMessage("Вы присоединились к кухне!"); await loadKitchen(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось присоединиться к кухне."); } finally { setActionLoading(false); }
  }

  function readQuantity(value: string) {
    if (!value.trim()) return null;
    const quantity = Number(value); return Number.isFinite(quantity) && quantity >= 0 ? quantity : undefined;
  }

  async function addProduct() {
    const name = productName.trim(); const quantity = readQuantity(productQuantity);
    if (!name) { setError("Введите название продукта."); return; }
    if (quantity === undefined) { setError("Количество должно быть неотрицательным числом."); return; }
    if (!household?.id || !userId) return;
    setProductLoading(true); setError("");
    try { const { error } = await supabase.from("products").insert({ household_id: household.id, name, quantity, unit: productUnit, category: productCategory, expiry_date: productExpiry || null, created_by: userId }); if (error) throw error; setProductName(""); setProductQuantity(""); setProductExpiry(""); setMessage("Продукт добавлен."); await loadProducts(household.id); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось добавить продукт."); } finally { setProductLoading(false); }
  }

  function startEdit(product: Product) { setEditing(product); setError(""); setMessage(""); }

  async function saveEdit() {
    if (!editing || !editing.name.trim()) { setError("Введите название продукта."); return; }
    const quantity = editing.quantity === null ? null : Number(editing.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) { setError("Количество должно быть неотрицательным числом."); return; }
    setProductLoading(true); setError("");
    try { const { error } = await supabase.from("products").update({ name: editing.name.trim(), quantity, unit: editing.unit, category: editing.category, expiry_date: editing.expiry_date || null }).eq("id", editing.id); if (error) throw error; setEditing(null); setMessage("Продукт изменён."); if (household) await loadProducts(household.id); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось изменить продукт."); } finally { setProductLoading(false); }
  }

  async function deleteProduct(id: string) {
    const { error } = await supabase.from("products").delete().eq("id", id); if (error) setError(error.message); else setProducts(current => current.filter(p => p.id !== id));
  }

  async function addShoppingItem() {
    if (!shoppingName.trim() || !household?.id || !userId) return;
    setShoppingLoading(true); setError("");
    try { const { error } = await supabase.from("shopping_items").insert({ household_id: household.id, name: shoppingName.trim(), done: false, created_by: userId }); if (error) throw error; setShoppingName(""); await loadShopping(household.id); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось добавить покупку."); } finally { setShoppingLoading(false); }
  }

  async function toggleShopping(item: ShoppingItem) {
    const { error } = await supabase.from("shopping_items").update({ done: !item.done }).eq("id", item.id);
    if (!error) setShopping(current => current.map(x => x.id === item.id ? { ...x, done: !item.done } : x)); else setError(error.message);
  }

  async function deleteShopping(id: string) {
    const { error } = await supabase.from("shopping_items").delete().eq("id", id); if (!error) setShopping(current => current.filter(x => x.id !== id)); else setError(error.message);
  }

  async function logout() { await supabase.auth.signOut(); router.push("/login"); router.refresh(); }

  const filteredProducts = useMemo(() => products.filter(p => (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())) && (categoryFilter === "Все" || p.category === categoryFilter)), [products, search, categoryFilter]);
  const activeShopping = shopping.filter(x => !x.done).length;

  if (loading) return <main className="app-page"><div className="loading">Загрузка...</div></main>;
  if (!household) return <main className="app-page"><div className="kitchen-setup"><div className="logo">🍳</div><h1>Добро пожаловать!</h1><p>Создайте общую кухню или присоединитесь к уже существующей.</p><section className="setup-section"><h2>Создать кухню</h2><input value={householdName} onChange={e => setHouseholdName(e.target.value)} placeholder="Название кухни" disabled={actionLoading}/><button className="primary-button" onClick={createKitchen} disabled={actionLoading}>{actionLoading ? "Создаём..." : "Создать нашу кухню"}</button></section><div className="divider"><span>или</span></div><section className="setup-section"><h2>Присоединиться</h2><input value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} placeholder="Например: A4F91C2B" maxLength={8} disabled={actionLoading}/><button className="secondary-button" onClick={joinKitchen} disabled={actionLoading}>{actionLoading ? "Подключаем..." : "Присоединиться"}</button></section>{error && <div className="form-error">{error}</div>}<button className="logout-button" onClick={logout}>Выйти</button></div></main>;

  return <main className="app-page">
    <div className="kitchen-header"><div><div className="eyebrow">WHAT TO COOK</div><h1>{household.name}</h1><p>{userEmail}</p></div><button className="logout-button" onClick={logout}>Выйти</button></div>
    <nav className="app-tabs"><button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>🥫 Продукты <b>{products.length}</b></button><button className={tab === "shopping" ? "active" : ""} onClick={() => setTab("shopping")}>🛒 Покупки <b>{activeShopping}</b></button><button className="disabled-tab" disabled>🍳 Рецепты <span>скоро</span></button><button className="disabled-tab" disabled>📅 План <span>скоро</span></button></nav>

    {tab === "products" && <section className="dashboard-grid"><section className="dashboard-card products-card"><div className="card-heading"><div><span className="card-label">МОЯ КУХНЯ</span><h2>Продукты</h2></div><span className="count-badge">{products.length}</span></div><div className="product-form"><input value={productName} onChange={e => setProductName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addProduct(); }} placeholder="Например, молоко" disabled={productLoading}/><div className="product-form-row"><input type="number" min="0" step="any" value={productQuantity} onChange={e => setProductQuantity(e.target.value)} placeholder="Количество" disabled={productLoading}/><select value={productUnit} onChange={e => setProductUnit(e.target.value)} disabled={productLoading}>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></div><div className="product-form-row"><select value={productCategory} onChange={e => setProductCategory(e.target.value)} disabled={productLoading}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><input type="date" value={productExpiry} onChange={e => setProductExpiry(e.target.value)} disabled={productLoading}/></div><button className="primary-button" onClick={addProduct} disabled={productLoading}>{productLoading ? "Добавляем..." : "+ Добавить продукт"}</button></div><div className="list-toolbar"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск продуктов..."/><select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Все</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div><ProductList products={filteredProducts} onDelete={deleteProduct} onEdit={startEdit}/>{filteredProducts.length !== products.length && <div className="filter-note">Показано {filteredProducts.length} из {products.length}</div>}</section><div className="dashboard-side"><section className="invite-card"><span className="card-label">КОД ПРИГЛАШЕНИЯ</span><div className="invite-code">{household.invite_code}</div><p>Передайте код второму человеку, чтобы добавить его в общую кухню.</p></section><section className="members-card"><h2>Участники</h2><div className="members-list">{members.map(member => <div className="member" key={member.user_id}><div className="member-avatar">{member.role === "owner" ? "👑" : "👤"}</div><div><strong>{member.user_id === household.created_by ? "Владелец кухни" : "Участник"}</strong><span>{member.role}</span></div></div>)}</div></section></div></section>}

    {tab === "shopping" && <section className="dashboard-card shopping-card"><div className="card-heading"><div><span className="card-label">ОБЩИЙ СПИСОК</span><h2>Покупки</h2></div><span className="count-badge">{activeShopping}</span></div><div className="shopping-add"><input value={shoppingName} onChange={e => setShoppingName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addShoppingItem(); }} placeholder="Что нужно купить?" disabled={shoppingLoading}/><button className="primary-button" onClick={addShoppingItem} disabled={shoppingLoading}>{shoppingLoading ? "Добавляем..." : "+ Добавить"}</button></div><div className="shopping-list">{shopping.length === 0 ? <div className="empty-state">Список покупок пуст.</div> : <>{shopping.filter(x => !x.done).map(item => <ShoppingRow key={item.id} item={item} onToggle={toggleShopping} onDelete={deleteShopping}/>) }{shopping.some(x => x.done) && <><div className="completed-label">Куплено</div>{shopping.filter(x => x.done).map(item => <ShoppingRow key={item.id} item={item} onToggle={toggleShopping} onDelete={deleteShopping}/>)}</>}</>}</div></section>}

    {error && <div className="form-error">{error}</div>}{message && <div className="form-message">{message}</div>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><div className="edit-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-header"><div><span className="card-label">ПРОДУКТ</span><h2>Редактировать</h2></div><button className="modal-close" onClick={() => setEditing(null)}>×</button></div><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Название"/><div className="product-form-row"><input type="number" min="0" step="any" value={editing.quantity ?? ""} onChange={e => setEditing({ ...editing, quantity: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Количество"/><select value={editing.unit ?? "шт."} onChange={e => setEditing({ ...editing, unit: e.target.value })}>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></div><div className="product-form-row"><select value={editing.category ?? "Другое"} onChange={e => setEditing({ ...editing, category: e.target.value })}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><input type="date" value={editing.expiry_date ?? ""} onChange={e => setEditing({ ...editing, expiry_date: e.target.value || null })}/></div><div className="modal-actions"><button className="secondary-button" onClick={() => setEditing(null)}>Отмена</button><button className="primary-button" onClick={saveEdit} disabled={productLoading}>{productLoading ? "Сохраняем..." : "Сохранить"}</button></div></div></div>}
  </main>;
}

function ShoppingRow({ item, onToggle, onDelete }: { item: ShoppingItem; onToggle: (item: ShoppingItem) => void; onDelete: (id: string) => void }) {
  return <div className={`shopping-item ${item.done ? "shopping-done" : ""}`}><button className="check-button" onClick={() => onToggle(item)}>{item.done ? "✓" : ""}</button><div className="shopping-name">{item.name}{item.quantity !== null && <span className="muted"> · {item.quantity} {item.unit ?? ""}</span>}</div><button className="delete-button" onClick={() => onDelete(item.id)}>×</button></div>;
}
