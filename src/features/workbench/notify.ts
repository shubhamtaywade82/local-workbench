// The one way the workbench tells the user about an outcome. Built on the
// toast system the layout already mounts, so messages are announced and dismissible.

import { toast } from "@/hooks/use-toast";

export type NoticeTone = "info" | "success" | "warning" | "error";

const TITLES: Readonly<Record<NoticeTone, string>> = {
  info: "Note",
  success: "Done",
  warning: "Check this",
  error: "Something went wrong",
};

export function notify(message: string, tone: NoticeTone = "info"): void {
  toast({
    title: TITLES[tone],
    description: message,
    variant: tone === "error" ? "destructive" : "default",
  });
}
