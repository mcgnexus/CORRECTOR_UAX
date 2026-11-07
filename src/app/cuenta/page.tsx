import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccountProfile } from "@/lib/users";
import OfflineQueueSync from "../examenes/offline-queue-sync";
import AccountForm from "./account-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const profile = await getAccountProfile(session.user.id, session.user.sessionVersion);
  if (!profile) redirect("/login");
  return <main id="main-content" className="contenedor">
    <p><Link href="/examenes">Volver a examenes</Link></p>
    <h1>Mi cuenta</h1>
    <p>El acceso se realiza con tu correo electronico. Los datos academicos son opcionales.</p>
    <AccountForm initialProfile={profile} />
    <OfflineQueueSync ownerId={session.user.id} />
  </main>;
}
