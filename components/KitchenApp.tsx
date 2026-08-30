"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
};

type Member = {
  user_id: string;
  role: string;
};

export default function KitchenApp() {
  const router = useRouter();
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState("");
  const [household, setHousehold] = useState<Household | null>(null);

  const [members, setMembers] = useState<Member[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [householdName, setHouseholdName] = useState("Наша кухня");
  const [inviteCode, setInviteCode] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadKitchen() {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserEmail(user.email ?? "");

      const { data: membership, error: membershipError } =
        await supabase
          .from("household_members")
          .select("household_id, user_id, role")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        setHousehold(null);
        setMembers([]);
        return;
      }

      const { data: householdData, error: householdError } =
        await supabase
          .from("households")
          .select("id, name, invite_code, created_by")
          .eq("id", membership.household_id)
          .single();

      if (householdError) {
        throw householdError;
      }

      const { data: memberData, error: membersError } =
        await supabase
          .from("household_members")
          .select("user_id, role")
          .eq("household_id", membership.household_id);

      if (membersError) {
        throw membersError;
      }

      setHousehold(householdData);
      setMembers(memberData ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось загрузить кухню."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKitchen();
  }, []);

  async function createKitchen() {
    setActionLoading(true);
    setError("");
    setMessage("");

    try {
      const { data, error } = await supabase.rpc("create_household", {
        household_name: householdName.trim() || "Наша кухня",
      });

      if (error) {
        throw error;
      }

      setHousehold(data);
      setMembers([
        {
          user_id: data.created_by,
          role: "owner",
        },
      ]);

      setMessage("Кухня создана!");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось создать кухню."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function joinKitchen() {
    if (!inviteCode.trim()) {
      setError("Введите код приглашения.");
      return;
    }

    setActionLoading(true);
    setError("");
    setMessage("");

    try {
      const { data, error } = await supabase.rpc("join_household", {
        code: inviteCode.trim(),
      });

      if (error) {
        throw error;
      }

      setHousehold(data);
      setMessage("Вы присоединились к кухне!");

      await loadKitchen();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось присоединиться к кухне."
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();

    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="app-page">
        <div className="loading">Загрузка...</div>
      </main>
    );
  }

  if (!household) {
    return (
      <main className="app-page">
        <div className="kitchen-setup">
          <div className="logo">🍳</div>

          <h1>Добро пожаловать!</h1>

          <p>
            Создайте общую кухню или присоединитесь к уже существующей.
          </p>

          <section className="setup-section">
            <h2>Создать кухню</h2>

            <input
              value={householdName}
              onChange={(event) =>
                setHouseholdName(event.target.value)
              }
              placeholder="Название кухни"
              disabled={actionLoading}
            />

            <button
              className="primary-button"
              onClick={createKitchen}
              disabled={actionLoading}
            >
              {actionLoading ? "Создаём..." : "Создать нашу кухню"}
            </button>
          </section>

          <div className="divider">
            <span>или</span>
          </div>

          <section className="setup-section">
            <h2>Присоединиться</h2>

            <input
              value={inviteCode}
              onChange={(event) =>
                setInviteCode(event.target.value.toUpperCase())
              }
              placeholder="Например: A4F91C2B"
              maxLength={8}
              disabled={actionLoading}
            />

            <button
              className="secondary-button"
              onClick={joinKitchen}
              disabled={actionLoading}
            >
              {actionLoading
                ? "Подключаем..."
                : "Присоединиться"}
            </button>
          </section>

          {error && <div className="form-error">{error}</div>}
          {message && <div className="form-message">{message}</div>}

          <button className="logout-button" onClick={logout}>
            Выйти
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="app-page">
      <div className="kitchen-header">
        <div>
          <div className="eyebrow">WHAT TO COOK</div>
          <h1>{household.name}</h1>
          <p>{userEmail}</p>
        </div>

        <button className="logout-button" onClick={logout}>
          Выйти
        </button>
      </div>

      <section className="invite-card">
        <div>
          <span className="card-label">КОД ПРИГЛАШЕНИЯ</span>

          <div className="invite-code">
            {household.invite_code}
          </div>

          <p>
            Передайте этот код второму человеку, чтобы добавить его
            в вашу общую кухню.
          </p>
        </div>
      </section>

      <section className="members-card">
        <h2>Участники</h2>

        <div className="members-list">
          {members.map((member) => (
            <div className="member" key={member.user_id}>
              <div className="member-avatar">
                {member.role === "owner" ? "👑" : "👤"}
              </div>

              <div>
                <strong>
                  {member.user_id === household.created_by
                    ? "Владелец кухни"
                    : "Участник"}
                </strong>

                <span>{member.role}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && <div className="form-error">{error}</div>}
      {message && <div className="form-message">{message}</div>}

      <section className="coming-soon">
        <span>🍳</span>

        <h2>Что приготовить?</h2>

        <p>
          Здесь скоро появится подбор блюд на основе продуктов,
          которые есть дома.
        </p>
      </section>
    </main>
  );
}