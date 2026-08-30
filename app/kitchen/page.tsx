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

  return <KitchenApp />;
}