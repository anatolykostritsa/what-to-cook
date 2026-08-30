"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ProductList from "./ProductList";
import ShoppingList from "./ShoppingList";
import RecipeSuggestions from "./RecipeSuggestions";

type Product = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  expiry_date: string | null;
};

type ShoppingItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  done: boolean;
};

type Props = {
  userId: string;
  email: string;
  householdId: string | null;
  role: string | null;
};

export default function KitchenApp({
  userId,
  email,
  householdId: initialHouseholdId,
  role,
}: Props) {
  const supabase = createClient();

  const [householdId, setHouseholdId] = useState(initialHouseholdId);
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);

  const [loading, setLoading] = useState(true);

  const [newProduct, setNewProduct] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newUnit, setNewUnit] = useState("шт.");
  const [newExpiry, setNewExpiry] = useState("");

  const [newShopping, setNewShopping] = useState("");

  const [joinCode, setJoinCode] = useState("");

  async function loadHousehold() {
    if (!householdId) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("households")
      .select("name, invite_code")
      .eq("id", householdId)
      .single();

    if (data) {
      setHouseholdName(data.name);
      setInviteCode(data.invite_code);
    }
  }

  async function loadProducts() {
    if (!householdId) return;

    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("household_id", householdId)
      .order("expiry_date", { ascending: true });

    setProducts(data ?? []);
  }

  async function loadShopping() {
    if (!householdId) return;

    const { data } = await supabase
      .from("shopping_items")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });

    setShopping(data ?? []);
  }

  async function createHousehold() {
    const code = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    const { data, error } = await supabase
      .from("households")
      .insert({
        name: "Наша кухня",
        invite_code: code,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      alert(error?.message ?? "Не удалось создать кухню");
      return;
    }

    const { error: memberError } = await supabase
      .from("household_members")
      .insert({
        household_id: data.id,
        user_id: userId,
        role: "owner",
      });

    if (memberError) {
      alert(memberError.message);
      return;
    }

    setHouseholdId(data.id);
    setHouseholdName(data.name);
    setInviteCode(data.invite_code);
  }

  async function joinHousehold() {
    const code = joinCode.trim().toUpperCase();

    if (!code) return;

    const { data: household } = await supabase
      .from("households")
      .select("id, name, invite_code")
      .eq("invite_code", code)
      .single();

    if (!household) {
      alert("Кухня с таким кодом не найдена.");
      return;
    }

    const { error } = await supabase
      .from("household_members")
      .insert({
        household_id: household.id,
        user_id: userId,
        role: "member",
      });

    if (error) {
      if (error.code === "23505") {
        alert("Вы уже подключены к этой кухне.");
      } else {
        alert(error.message);
      }

      return;
    }

    setHouseholdId(household.id);
    setHouseholdName(household.name);
    setInviteCode(household.invite_code);
    setJoinCode("");
  }

  async function addProduct() {
    if (!householdId || !newProduct.trim()) return;

    const quantity = newQuantity
      ? Number(newQuantity.replace(",", "."))
      : null;

    const { error } = await supabase.from("products").insert({
      household_id: householdId,
      name: newProduct.trim(),
      quantity,
      unit: newUnit,
      expiry_date: newExpiry || null,
      created_by: userId,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setNewProduct("");
    setNewQuantity("");
    setNewExpiry("");

    await loadProducts();
  }

  async function deleteProduct(id: string) {
    await supabase
      .from("products")
      .delete()
      .eq("id", id);

    await loadProducts();
  }

  async function addShoppingItem() {
    if (!householdId || !newShopping.trim()) return;

    const { error } = await supabase
      .from("shopping_items")
      .insert({
        household_id: householdId,
        name: newShopping.trim(),
        created_by: userId,
      });

    if (error) {
      alert(error.message);
      return;
    }

    setNewShopping("");
    await loadShopping();
  }

  async function toggleShopping(id: string, done: boolean) {
    await supabase
      .from("shopping_items")
      .update({ done: !done })
      .eq("id", id);

    await loadShopping();
  }

  async function deleteShopping(id: string) {
    await supabase
      .from("shopping_items")
      .delete()
      .eq("id", id);

    await loadShopping();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  useEffect(() => {
    async function start() {
      await loadHousehold();
      await loadProducts();
      await loadShopping();
      setLoading(false);
    }

    start();
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;

    const channel = supabase
      .channel(`household-${householdId}`)

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          loadProducts();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shopping_items",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          loadShopping();
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId]);

  if (loading) {
    return (
      <main className="loading-page">
        <div>Загружаем кухню...</div>
      </main>
    );
  }

  if (!householdId) {
    return (
      <main className="setup-page">
        <div className="setup-card">
          <div className="brand-mark">🍳</div>

          <h1>Ваша кухня</h1>

          <p>
            Создайте общую кухню или присоединитесь к уже существующей.
          </p>

          <button
            className="primary-button"
            onClick={createHousehold}
          >
            Создать нашу кухню
          </button>

          <div className="divider">или</div>

          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Код приглашения"
          />

          <button
            className="secondary-button"
            onClick={joinHousehold}
          >
            Присоединиться
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">НАША КУХНЯ</div>

          <h1>{householdName}</h1>

          <p className="muted">
            {email}
          </p>
        </div>

        <button
          className="ghost-button"
          onClick={logout}
        >
          Выйти
        </button>
      </header>

      <section className="invite-card">
        <div>
          <strong>Пригласить мужа</strong>

          <p>
            Передайте ему этот код:
          </p>
        </div>

        <div className="invite-code">
          {inviteCode}
        </div>
      </section>

      <div className="dashboard">

        <section className="card">
          <div className="section-header">
            <div>
              <h2>🥕 Продукты</h2>
              <p>Что сейчас есть дома</p>
            </div>
          </div>

          <div className="add-row">
            <input
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              placeholder="Например, курица"
            />

            <input
              className="quantity-input"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              placeholder="500"
              inputMode="decimal"
            />

            <select
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
            >
              <option>г</option>
              <option>кг</option>
              <option>мл</option>
              <option>л</option>
              <option>шт.</option>
              <option>уп.</option>
            </select>

            <input
              type="date"
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
            />

            <button
              className="primary-button"
              onClick={addProduct}
            >
              Добавить
            </button>
          </div>

          <ProductList
            products={products}
            onDelete={deleteProduct}
          />
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>✨ Что приготовить?</h2>
              <p>
                Подбор блюд из того, что уже есть дома
              </p>
            </div>
          </div>

          <RecipeSuggestions
            products={products}
            householdId={householdId}
          />
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>🛒 Покупки</h2>
              <p>
                Общий список
              </p>
            </div>
          </div>

          <div className="add-row">
            <input
              value={newShopping}
              onChange={(e) => setNewShopping(e.target.value)}
              placeholder="Что нужно купить?"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addShoppingItem();
                }
              }}
            />

            <button
              className="primary-button"
              onClick={addShoppingItem}
            >
              Добавить
            </button>
          </div>

          <ShoppingList
            items={shopping}
            onToggle={toggleShopping}
            onDelete={deleteShopping}
          />
        </section>
      </div>
    </main>
  );
}
