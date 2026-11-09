/** Outbound customer notifications (SMS / app push). */
export interface Notifier {
  send(to: string, message: string): Promise<void>;
}

export class MemoryNotifier implements Notifier {
  readonly sent: { to: string; message: string }[] = [];
  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message });
  }
}
