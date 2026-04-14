import type { ReactNode } from "react";
import { Platform } from "react-native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { STRIPE_MERCHANT_IDENTIFIER, STRIPE_PUBLISHABLE_KEY } from "@/lib/stripePublishableKey";

type Props = {
  children: ReactNode;
};

/**
 * iOS/Android: StripeProvider when a publishable key is set. (Web uses StripeProviderGate.web.tsx.)
 */
export function StripeProviderGate({ children }: Props) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return (
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      urlScheme="poolyn"
      {...(Platform.OS === "ios"
        ? { merchantIdentifier: STRIPE_MERCHANT_IDENTIFIER }
        : {})}
    >
      <>{children}</>
    </StripeProvider>
  );
}
