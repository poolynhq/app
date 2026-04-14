import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Web: Stripe React Native is native-only. Pass children through without StripeProvider.
 */
export function StripeProviderGate({ children }: Props) {
  return <>{children}</>;
}
