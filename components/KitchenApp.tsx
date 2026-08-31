"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProductList from "./ProductList";

type Household = { id: string; name: string; invite_code: string; created_by: string };
type Member = { user_id: string; role: string };
type Product = { id: string; name: string; quantity: number | null; unit: string | null; category: string | null; expiry_date: string | null };

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
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [householdName, setHouseholdName] = useState("Наша кухня");
  const [inviteCode, setInviteCode] = useState("");
  const [productName, setProductName] = useState("");
  const [productQuantity, setProductQuantity] = useState("");
  const [productUnit, setProductUnit] = useState("шт.");
  const [productCategory, setProductCategory] = useState("Другое");
  const [productExpiry, setProductExpiry] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadProducts(householdId: string) {
    const { data, error: productsError } = await supabase
      .from("products")
      .select("id, name, quantity, unit, category, expiry_date")
      .eq("household_id", householdId)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });
    if (!productsError) setProducts(data ?? []);
  }

  async function loadKitchen() {
    setLoading(true);
    setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      setUserEmail(user.email ?? "");

      const { data: membership, error: membershipError } = await supabase
        .from("household_members")
        .select("household_id, user_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;

      if (!membership) {
        setHousehold(null);
        setMembers([]);
        setProducts([]);
        return;
      }

      const [householdResult, membersResult, productsResult] = await Promise.all([
        supabase.from("households").select("id, name, invite_code, created_by").eq("id", membership.household_id).single(),
        supabase.from("household_members").select("user_id, role").eq("household_id", membership.household_id),
        supabase.from("products").select("id, name, quantity, unit, category, expiry_date").eq("household_id", membership.household_id).order("expiry_date", { ascending: true, nullsFirst: false }).order("name", { ascending: true }),
      ]);
      if (householdResult.error) throw householdResult.error;
      if (membersResult.error) throw membersResult.error;
      if (productsResult.error) throw productsResult.error;
      setHousehold(householdResult.data);
      setMembers(membersResult.data ?? []);
      setProducts(productsResult.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить кухню.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadKitchen(); }, []);

  useEffect(() => {
    if (!household?.id) return;
    const channel = supabase.channel(`products:${household.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `household_id=eq.${household.id}` }, () => loadProducts(household.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [household?.id]);

  async function createKitchen() {
    setActionLoading(true); setError(""); setMessage("");
    try {
      const { data, error: rpcError } = await supabase.rpc("create_household", { household_name: householdName.trim() || "Наша кухня" });
      if (rpcError) throw rpcError;
      setHousehold(data); setMembers([{ user_id: data.created_by, role: "owner" }]); setProducts([]); setMessage("Кухня создана!");
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось создать кухню."); }
    finally { setActionLoading(false); }
  }

  async function joinKitchen() {
    if (!inviteCode.trim()) { setError("Введите код приглашения."); return; }
    setActionLoading(true); setError(""); setMessage("");
    try {
      const { data, error: rpcError } = await supabase.rpc("join_household", { code: inviteCode.trim() });
      if (rpcError) throw rpcError;
      setHousehold(data); setMessage("Вы присоединились к кухне!"); await loadKitchen();
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось присоединиться к кухне."); }
    finally { setActionLoading(false); }
  }

  async function addProduct() {
    const name = productName.trim();
    if (!name) { setError("Введите название продукта."); return; }
    if (!household?.id || !userId) return;
    const quantity = productQuantity.trim() ? Number(productQuantity) : null;
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) { setError("Количество должно быть неотрицательным числом."); return; }
    setProductLoading(true); setError(""); setMessage("");
    try {
      const { error: insertError } = await supabase.from("products").insert({ household_id: household.id, name, quantity, unit: productUnit, category: productCategory, expiry_date: productExpiry || null, created_by: userId });
      if (insertError) throw insertError;
      setProductName(""); setProductQuantity(""); setProductExpiry(""); setMessage("Продукт добавлен."); await loadProducts(household.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось добавить продукт."); }
    finally { setProductLoading(false); }
  }

  async function deleteProduct(id: string) {
    setError(""); setMessage("");
    const { error: deleteError } = await supabase.from("products").delete().eq("id", id);
    if (deleteError) { setError(deleteError.message); return; }
    setProducts(current => current.filter(product => product.id !== id));
  }

  async function logout() { await supabase.auth.signOut(); router.push("/login"); router.refresh(); }

  if (loading) return <main className="app-page"><div className="loading">Загрузка...</div></main>;

  if (!household) return (
    <main className="app-page"><div className="kitchen-setup">
      <div className="logo">🍳</div><h1>Добро пожаловать!</h1><p>Создайте общую кухню или присоединитесь к уже существующей.</p>
      <section className="setup-section"><h2>Создать кухню</h2><input value={householdName} onChange={e => setHouseholdName(e.target.value)} placeholder="Название кухни" disabled={actionLoading}/><button className="primary-button" onClick={createKitchen} disabled={actionLoading}>{actionLoading ? "Создаём..." : "Создать нашу кухню"}</button></section>
      <div className="divider"><span>или</span></div>
      <section className="setup-section"><h2>Присоединиться</h2><input value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} placeholder="Например: A4F91C2B" maxLength={8} disabled={actionLoading}/><button className="secondary-button" onClick={joinKitchen} disabled={actionLoading}>{actionLoading ? "Подключаем..." : "Присоединиться"}</button></section>
      {error && <div className="form-error">{error}</div>}{message && <div className="form-message">{message}</div>}<button className="logout-button" onClick={logout}>Выйти</button>
    </div></main>
  );

  return <main className="app-page">
    <div className="kitchen-header"><div><div className="eyebrow">WHAT TO COOK</div><h1>{household.name}</h1><p>{userEmail}</p></div><button className="logout-button" onClick={logout}>Выйти</button></div>
    <section className="dashboard-grid">
      <section className="dashboard-card products-card"><div className="card-heading"><div><span className="card-label">МОЯ КУХНЯ</span><h2>Продукты</h2></div><span className="count-badge">{products.length}</span></div>
        <div className="product-form"><input value={productName} onChange={e => setProductName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addProduct(); }} placeholder="Например, молоко" disabled={productLoading}/><div className="product-form-row"><input type="number" min="0" step="any" value={productQuantity} onChange={e => setProductQuantity(e.target.value)} placeholder="Количество" disabled={productLoading}/><select value={productUnit} onChange={e => setProductUnit(e.target.value)} disabled={productLoading}>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></div><div className="product-form-row"><select value={productCategory} onChange={e => setProductCategory(e.target.value)} disabled={productLoading}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><input type="date" value={productExpiry} onChange={e => setProductExpiry(e.target.value)} disabled={productLoading}/></div><button className="primary-button" onClick={addProduct} disabled={productLoading}>{productLoading ? "Добавляем..." : "+ Добавить продукт"}</button></div>
        <ProductList products={products} onDelete={deleteProduct}/>
      </section>
      <div className="dashboard-side"><section className="invite-card"><span className="card-label">КОД ПРИГЛАШЕНИЯ</span><div className="invite-code">{household.invite_code}</div><p>Передайте код второму человеку, чтобы добавить его в общую кухню.</p></section><section className="members-card"><h2>Участники</h2><div className="members-list">{members.map(member => <div className="member" key={member.user_id}><div className="member-avatar">{member.role === "owner" ? "👑" : "👤"}</div><div><strong>{member.user_id === household.created_by ? "Владелец кухни" : "Участник"}</strong><span>{member.role}</span></div></div>)}</div></section></div>
    </section>
    {error && <div className="form-error">{error}</div>}{message && <div className="form-message">{message}</div>}
    <section className="feature-grid"><div className="feature-card"><span>🍳</span><h2>Что приготовить?</h2><p>Подберём блюда на основе продуктов, которые уже есть дома.</p></div><div className="feature-card"><span>🛒</span><h2>Список покупок</h2><p>Общий список для вас обоих. Следующим этапом подключим его к кухне.</p></div><div className="feature-card"><span>📅</span><h2>План питания</h2><p>Планируйте завтраки, обеды и ужины на несколько дней вперёд.</p></div></section>
  </main>;
}
