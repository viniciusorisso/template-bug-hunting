import type { ResolvedBugEvent, ResolvedBugNotifier } from "@ts-bug-hunt/core";

export type NotificationBanner = {
  title: string;
  message: string;
};

export class BrowserBannerResolvedBugNotifier implements ResolvedBugNotifier {
  constructor(private readonly publish: (banner: NotificationBanner) => void) {}

  notify(event: ResolvedBugEvent): void {
    this.publish({
      title: `Bug resolvido: ${event.bugId}`,
      message: `${event.title} marcado como resolvido nesta sessao.`
    });
  }
}
