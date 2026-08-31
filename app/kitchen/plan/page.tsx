import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MealPlanPanel from "@/components/MealPlanPanel";

export default async function MealPlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/kitchen");

  return (
    <main className="app-page">
      <div className="kitchen-header">
        <div>
          <div className="eyebrow">WHAT TO COOK</div>
          <h1>План питания</h1>
          <p>Общий план вашей кухни</p>
        </div>
        <a className="secondary-button" href="/kitchen">← Вернуться на кухню</a>
      </div>
      <MealPlanPanel householdId={membership.household_id} userId={user.id} />
    </main>
  );
}
