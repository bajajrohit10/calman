import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth";

export default async function Home() {
  const { userId } = await getViewer();
  redirect(userId ? "/my-day" : "/login");
}
