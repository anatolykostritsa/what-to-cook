import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import KitchenApp from "@/components/KitchenApp";

export default async function KitchenPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id);

  const membership = memberships?.[0];

  return (
    <KitchenApp
      userId={user.id}
      email={user.email ?? ""}
      householdId={membership?.household_id ?? null}
      role={membership?.role ?? null}
    />
  );
}
