/** Environment bindings/vars exposed to the Worker. */
export interface Env {
  /** Public URL of this deployment, used as the gateway default. */
  PROXY_URL?: string;
  /** "true"/"1" enables request logging. */
  DEBUG?: string;
}
