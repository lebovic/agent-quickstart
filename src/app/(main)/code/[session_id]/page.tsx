import { SessionPageClient } from "@/components/session-view/SessionPageClient"

type Props = {
  params: Promise<{ session_id: string }>
}

export default async function SessionPage({ params }: Props) {
  const { session_id } = await params
  return <SessionPageClient sessionId={session_id} />
}
