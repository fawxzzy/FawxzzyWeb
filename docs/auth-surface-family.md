# Fawxzzy Auth Surface Family

Status: source contract for the shared Website, Fitness, and Mazer authentication family.

## Decision

The three products use one rigid authentication anatomy. Product theme may change; screen structure may not.

- Fitness is the canonical structural reference: centered fields, no subtitle, a compact secondary-action row, one strong bottom-dock action, safe-area-aware spacing, and minimal visual noise.
- The account host owns one declarative screen template and a closed presentation registry rather than three copied screen implementations.
- Each product context may replace only its background/accent token, product wordmark, destination-specific wording, allowlisted return destination, and legal-link row.
- Context selection is presentation-only. It never selects an Auth provider, callback, session, credential boundary, or arbitrary return URL.
- Capability truth wins over visual consistency. A product must never show an enabled action when its account adapter or service registration is unavailable.

## Required anatomy

Every sign-in and create-account surface provides these elements in this order:

1. Product identity.
2. `Welcome` or `Create account`, with the remembered username directly below `Welcome` when available.
3. Labeled identifier and password controls with password-manager semantics and the shared password-visibility icon.
4. A compact sign-in/create-account/recovery action row.
5. One full-width bottom-dock submit action with visible disabled and pending states.

Required-field validation uses the same red field outline in every context without adding a floating error paragraph. Provider, recovery, and completion outcomes are announced accessibly and temporarily replace the bottom-dock label for five seconds before the normal action label returns.

Every editable credential field preserves native mobile caret placement, long-press selection, and text-callout behavior. The field values remain centered, and the complete field set remains one screen-centered group; visual centering must never be implemented by suppressing native text selection or touch editing.

The product marker, screen title, and remembered username form one top-anchored intro group. The complete field set is independently centered against the viewport, and the primary action remains independently bottom-anchored. Field count must not pull the intro down or move the bottom action. The product-owned password reveal is the only visible reveal control; browser-native duplicate reveal and clear controls are suppressed without changing password-manager or autofill semantics.

The secondary-action rail is geometry-owned rather than flow-owned: it reserves one 44px text-action row and one 32px lower row, with its lower edge fixed 16px above the 56px bottom dock. When legal links exist, screen actions occupy the upper row and legal links occupy the lower row. When legal links do not exist, screen actions occupy that same lower-row position rather than jumping upward. Every divider is the same shared 8px-by-14px component with a 2px stroke, pinned to the exact horizontal screen centerline and vertically centered against its neighboring text.

The Fitness presentation derives its public Privacy Policy and Terms of Service from the catalog's current Fitness origin; the account host renders those live destinations without copying the legal documents, switching early to a planned origin, or changing product ownership.

The authenticated account surface follows the current Mazer account hierarchy: product marker, `Account` title, username and email identity fields, one compact recovery action in the shared secondary rail, and a full-width red `Sign out` dock action. It does not repeat the public app catalog, connection placeholders, or unfinished service-registration copy.

The forced first-run auth surface does not include a home/back action, subtitle, guest-play action, or separate display-name field. Username is the public display name.

The family requires 44px minimum interactive targets, visible keyboard focus, no horizontal overflow at 320px, reduced-motion support, and safe-area-aware vertical spacing.

## Product variants

### FawxzzyWeb

- Product marker: `Fawxzzy`.
- Background: Fawxzzy wolf-brand charcoal, sage, and soft neutral light fields.
- Desktop and mobile: the same bounded one-column Fitness-shaped frame.
- The remembered username is stored as optional local presentation state after a successful session and never becomes authentication authority.
- Current service boundary: account actions remain visibly unavailable unless the approved adapter resolves at runtime.
- Current implementation status: the account host renders Website, Fitness, and Mazer presentation contexts from one registry. Fitness and Mazer consumer integration remains pending until their owner repositories adopt the broker contract from reviewed exact heads.

### Fitness

- Preserve the existing Fitness auth shell, field treatment, bottom action rhythm, and green fitness background.
- Copy may name Fitness-specific account outcomes.
- Do not restyle the active login route while another exact writer owns it. Reconcile that work first, then change only proven contract gaps.

### Mazer

- Implement the same anatomy inside the Phaser runtime rather than importing Website or Fitness components.
- Background: Mazer's own static auth background; gameplay, simulation, announcements, and ambient motion are halted while auth is visible.
- Preserve one overlay and recoverable input behavior without guest-play access.
- Do not change the auth/menu surface while another exact writer owns it. Reconcile that work first, then implement from a fresh exact parent.

## Mazer pattern intake

| Pattern | Decision | Application |
| --- | --- | --- |
| Safe-area and dynamic viewport ownership | ADAPT | Keep the auth task and primary action clear of browser and device insets. |
| Persistent bottom controls | ADAPT | Use the Fitness rhythm for the primary auth action without copying React layout code. |
| Safe-default responsive layouts | ADOPT | Keep labels, fields, and actions usable across the supported viewport matrix. |
| Install capability | NOT_APPLICABLE | Auth layout work does not change install behavior. |
| Served-build provenance | ADOPT | Verify the final Mazer implementation against its served exact build. |
| One overlay and recoverable interaction | ADOPT | Keep one bounded auth overlay and preserve escape/recovery behavior. |
| Accessible motion preferences | ADAPT | Reduce or stop background motion without removing product identity. |
| Versioned persistent state | ADOPT | Preserve current state contracts; this family introduces no schema change. |

## Sequencing and ownership

1. Fitness remains the locked structural reference.
2. FawxzzyWeb proves the declarative template, presentation registry, field feedback, transient action messaging, reset flow, and optional legal row first.
3. Fitness and Mazer remain unchanged while the Website host proves every registered presentation. Consumer navigation, broker exchange, and app-owned session adoption remain separately gated.
4. Each owner repository then adapts its rendering primitive to the same contract; it does not copy a second state machine.
5. Each product requires focused tests, responsive screenshots, exact-head review, and a separately authorized release.

Failure mode: visual mimicry without a shared structural contract drifts into absolute positioning, extra copy, inconsistent actions, and moving controls. Tests must assert the anatomy and layout behavior, not only the presence of labels.

This contract grants no commit, push, pull-request, merge, provider, deployment, or production authority.
