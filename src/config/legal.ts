export const legalCenter = {
  lastUpdated: {
    dateTime: "2026-09-13",
    label: "September 13, 2026",
  },
  documents: {
    platformPrivacy: {
      description: "How Fawxzzy handles information across the website and shared account service.",
      eyebrow: "Fawxzzy legal",
      id: "platform-privacy",
      path: "/privacy",
      sections: [
        {
          heading: "Information we handle",
          paragraphs: [
            "The shared account service handles the email address, username or display name, account identifier, authentication session, and security information needed to create and protect your account.",
            "Your browser may keep the signed-in session, remembered sign-in name, and security-generation markers. A Mazer sign-in request may use a short-lived, secure, browser-only cookie so the request can survive a sign-in without exposing its identifier to page scripts.",
          ],
        },
        {
          heading: "How we use information",
          paragraphs: [
            "We use this information to authenticate you, recover your account, connect supported Fawxzzy apps to the same account, prevent stale or replayed sign-in requests, and operate and secure the services.",
            "The public Fawxzzy website may send closed first-party navigation events when its analytics connection is enabled. The account website does not send storefront analytics, and those events exclude account identifiers and free-form text.",
          ],
        },
        {
          heading: "Service providers and retention",
          paragraphs: [
            "Supabase provides account and application data services. Vercel provides web hosting and request delivery. These providers may process ordinary technical request information needed to operate and secure their services.",
            "We keep information only as long as reasonably needed to provide the service, protect it, meet legal obligations, and resolve disputes. We do not sell personal information or use it for advertising.",
          ],
        },
        {
          heading: "Your choices",
          paragraphs: [
            "You can sign out, reset your password, and update supported account details from the account service. Use the current contact path published on the Fawxzzy website for privacy or account questions.",
          ],
        },
      ],
      title: "Privacy Policy",
      version: "2026-09-13",
    },
    platformTerms: {
      description: "Terms for the Fawxzzy website and shared account service.",
      eyebrow: "Fawxzzy legal",
      id: "platform-terms",
      path: "/terms",
      sections: [
        {
          heading: "Using Fawxzzy",
          paragraphs: [
            "These terms apply to the Fawxzzy website and shared account service. You must provide accurate account information, keep your sign-in credentials secure, and be responsible for activity performed through your account.",
          ],
        },
        {
          heading: "Acceptable use",
          paragraphs: [
            "Do not misuse the services, interfere with their operation, attempt unauthorized access, abuse other users, or use the services in a way that violates applicable law or another person's rights.",
          ],
        },
        {
          heading: "Service changes and availability",
          paragraphs: [
            "We may improve, change, suspend, or discontinue features. We work to keep the services dependable, but they are provided as available and without a promise that every feature will always be uninterrupted or error-free.",
          ],
        },
        {
          heading: "Responsibility and termination",
          paragraphs: [
            "To the extent permitted by law, Fawxzzy is not responsible for indirect or consequential losses arising from use of the services. We may restrict access when reasonably needed for security, abuse prevention, legal compliance, or material violation of these terms.",
          ],
        },
        {
          heading: "Changes to these terms",
          paragraphs: [
            "When these terms materially change, the updated version and date will be published here. Continued use after an effective update means the updated terms apply.",
          ],
        },
      ],
      title: "Terms of Service",
      version: "2026-09-13",
    },
    mazerPrivacy: {
      description: "How Mazer uses the shared Fawxzzy account and gameplay information.",
      eyebrow: "Mazer legal",
      id: "mazer-privacy",
      path: "/legal/mazer/privacy",
      sections: [
        {
          heading: "Shared account information",
          paragraphs: [
            "Mazer uses your Fawxzzy account identifier, email address, and display name to recognize you and connect your game profile to the same account used by supported Fawxzzy services.",
          ],
        },
        {
          heading: "Game and progression information",
          paragraphs: [
            "Mazer may keep profile preferences, progression, an AI progression summary, and compact cycle summaries such as maze seed and size, path and wrong-turn counts, backtracks, completion time, control mode, and frame-timing measurements.",
            "Some state is kept locally in your browser. When remote sync is available and enabled, supported account and progression records can be stored with the shared data service. Mazer does not claim to store a full gameplay replay.",
          ],
        },
        {
          heading: "How information is used",
          paragraphs: [
            "Information is used to sign you in, preserve progress, restore supported settings, improve reliability and gameplay, and protect the service. Supabase provides account and data services, and Vercel provides hosting and request delivery.",
          ],
        },
        {
          heading: "Current commercial status and choices",
          paragraphs: [
            "Mazer currently has no paid features, subscriptions, virtual currency, or in-game purchases. We do not sell personal information or use Mazer information for advertising.",
            "You can sign out through the shared account service and use the current contact path on the Fawxzzy website for privacy or account questions.",
          ],
        },
      ],
      title: "Mazer Privacy Policy",
      version: "2026-09-13",
    },
    mazerTerms: {
      description: "Terms for playing Mazer with a shared Fawxzzy account.",
      eyebrow: "Mazer legal",
      id: "mazer-terms",
      path: "/legal/mazer/terms",
      sections: [
        {
          heading: "Playing Mazer",
          paragraphs: [
            "Mazer is a browser game with local-first play and supported remote account or progression sync. You are responsible for your account, device access, and conduct while using the game.",
          ],
        },
        {
          heading: "Acceptable use",
          paragraphs: [
            "Do not interfere with the game or its services, automate abusive traffic, attempt unauthorized access, exploit the service to harm others, or use Mazer in violation of applicable law.",
          ],
        },
        {
          heading: "Current pricing",
          paragraphs: [
            "Mazer currently has no paid features, subscriptions, refunds, virtual currency, or in-game purchases. No payment terms are being accepted through the current game.",
          ],
        },
        {
          heading: "Future monetization gate",
          paragraphs: [
            "Before any paid feature is enabled, the stable policies must be updated to explain prices and renewals or the digital-goods license, cancellation and refund rules, payment-processor data sharing, applicable taxes or geographic limits, and any virtual-item rules.",
            "Checkout must show visible links to the then-current policies and require affirmative acceptance of the applicable terms before a purchase can be submitted.",
          ],
        },
        {
          heading: "Availability, changes, and termination",
          paragraphs: [
            "We may improve, change, suspend, or discontinue Mazer features. The game is provided as available without a promise of uninterrupted or error-free operation. Access may be restricted when reasonably needed for security, abuse prevention, legal compliance, or a material violation of these terms.",
          ],
        },
      ],
      title: "Mazer Terms of Service",
      version: "2026-09-13",
    },
  },
} as const;

export type LegalDocument = (typeof legalCenter.documents)[keyof typeof legalCenter.documents];
