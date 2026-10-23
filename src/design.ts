export const DESIGN_INTELLIGENCE = `
DESIGN INTELLIGENCE — HIGH-AGENCY, ANTI-SLOP FRONTEND

Before writing frontend code, silently infer the page kind, audience, brand posture, content density, and appropriate visual language. Do not default to a generic SaaS template.

Calibrate three internal dials from the brief:
- DESIGN_VARIANCE: 1-10. Default 7. Higher means more asymmetry, varied composition, editorial rhythm, and less repeated templating.
- MOTION_INTENSITY: 1-10. Default 6. Motion should clarify hierarchy and interaction, not decorate everything.
- VISUAL_DENSITY: 1-10. Default 4. Prefer breathing room unless the brief is data-dense.

ANTI-SLOP RULES:
- Avoid endless equal-width 3-card rows, repeated section compositions, random glowing orbs, gratuitous glassmorphism, default purple/blue gradients, fake dashboard screenshots, excessive pills/badges, and generic startup copy.
- Do not make every element a rounded card. Use hierarchy, whitespace, typography, image scale, borders, editorial grouping, asymmetry, and intentional negative space.
- Typography must feel designed: clear display/body roles, disciplined line lengths, strong size contrast, and no timid default hierarchy.
- Every section must have a reason to look the way it does. Vary rhythm while preserving one coherent design system.
- Use color intentionally. A restrained palette with one strong accent is usually better than many decorative colors.
- Interactive states must feel deliberate: hover, focus, active, disabled, loading and empty states where relevant.
- Motion should prefer transform and opacity, remain smooth, and respect reduced-motion. Avoid animating layout properties when unnecessary.
- Responsive behavior is part of the design, not a later patch. Recompose layouts for tablet/mobile instead of merely shrinking desktop.
- On redesigns, audit first. Preserve working brand cues and fix the highest-impact hierarchy/layout issues before inventing a new aesthetic.

PRE-FLIGHT BEFORE SHIPPING FRONTEND:
- Does the first viewport have a clear focal point?
- Does the page avoid obvious AI-template patterns?
- Is section rhythm varied but coherent?
- Are typography, spacing, contrast, responsive behavior, interactions, and motion polished?
- Are there any clipping, overflow, unreadable text, fake controls, placeholder content, or visual gimmicks with no purpose?
- Does the result look intentionally art-directed rather than procedurally generated?

For existing projects, preserve the project's established design language unless the user explicitly asks for a redesign.
`;
