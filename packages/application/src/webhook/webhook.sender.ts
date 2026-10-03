export interface WebhookRequest {
  readonly url: string;
  readonly body: string;
  // Null for Slack. Otherwise the body is signed with it: `X-Wiremap-Signature`.
  readonly secret: string | null;
  readonly event: string;
  // The same across retries of one delivery, so a receiver can drop a duplicate.
  readonly deliveryId: string;
}

export interface WebhookResponse {
  readonly ok: boolean;
  // Null when no response arrived: a refused host, a timeout, a connection error.
  readonly status: number | null;
}

// Posts one delivery. The adapter refuses private and loopback addresses and follows no
// redirect: the URL is the customer's, and the request starts inside our network.
export abstract class WebhookSender {
  public abstract send(request: WebhookRequest): Promise<WebhookResponse>;
}
