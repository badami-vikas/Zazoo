import { Bot } from "lucide-react";
import { ChatView } from "../chat/ChatView";
import { Header } from "../components/shared/Header";

export function ChiefOfStaffPage() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <Header
        tabs={[{ id: "Chief of Staff", icon: Bot }]}
        activeTab="Chief of Staff"
        onTabChange={() => undefined}
      />
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col p-3 sm:p-6">
        <ChatView surface="chief_of_staff_page" className="rounded-md border bg-background" />
      </div>
    </div>
  );
}
