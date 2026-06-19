# 🤖 FRONT-END SYSTEM PROMPT & HANDOVER DOC
**Project:** Design-Bridge AI Interface
**Author:** Agent A (Audit Phase)
**Target Reader:** Agent C (Implementation Phase)

## 📌 1. Project Context & Mission
You are taking over the front-end implementation of the "Design-Bridge AI Interface." Your primary objective is to migrate the existing custom CSS/Tailwind codebase into a scalable, accessible, and standardized component library. 

**Absolute Rule:** Do not write custom CSS unless absolutely necessary. We are standardizing this codebase.

---

## 🛠 2. Tech Stack & Architecture
* **Framework:** React / Vite
* **Styling:** Tailwind CSS (v3/v4)
* **Component Library:** shadcn/ui (Radix Primitives)
* **Icons:** Lucide React
* **State Management:** React Context (e.g. `PinnedToolsContext`)

---

## 🎨 3. Design Tokens (Tailwind Configuration)
Do not use raw hex codes in the markup. Use the following semantic tokens mapped in `tailwind.config.js`:

### Colors
* `bg-background`: #f8f9fa
* `text-foreground`: #1f2937
* `bg-primary`: #6200EE
* `bg-secondary`: #00E5FF
* `border-border`: #e5e7eb

### Typography & Spacing
* **Font Family:** Inter, sans-serif
* **Border Radius:** `rounded-xl` (Standardized to 0.625rem / 10px across most cards and layout elements).

---

## 🧱 4. Component Strategy (The shadcn/ui Mandate)
Before building a component from scratch, check if a **shadcn/ui** equivalent exists. 

**Mapping the Interface:**
1. **Chat Bubbles/Outputs:** Use standard `<div>` containers but rely on the `Card` component structure (CardHeader, CardContent) for encapsulated AI responses. Wrap lists in `ScrollArea`.
2. **Input Prompts:** Use the shadcn `Textarea` or `Input` combined with a `Button` (variant: default or ghost).
3. **Sidebar/Navigation:** Use the shadcn `Sheet` or standard flex/grid layouts (or shadcn `Sidebar` primitive) with semantic `<nav>` tags for side panels.

---

## 📏 5. Strict Coding Standards
Agent C, you must adhere to the following guardrails:

1. **Tailwind Class Sorting:** Always sort classes logically (Layout -> Spacing -> Typography -> Visuals). Assume a Prettier Tailwind plugin is watching.
2. **Component Structure:** Use functional components with standard ES6 arrow functions. 
3. **Accessibility (A11y) First:** 
   * All interactive elements must have `aria-label`s if text is not visually present.
   * Ensure contrast ratios meet WCAG AA standards.
   * Support keyboard navigation (`focus-visible:ring`).
4. **No "Magic Numbers":** Avoid arbitrary Tailwind values like `w-[321px]`. Stick to the standard Tailwind spacing scale (e.g., `w-80`).

---

## 🚀 6. The Backlog (Your Immediate Tasks)
Agent C, begin execution in this exact order:

- [ ] **Task 1: The Config.** Update `tailwind.config.js` with the semantic design tokens extracted from the Figma audit.
- [ ] **Task 2: The Primitives.** Scaffold the base shadcn/ui components needed for the interface (Button, Input, Card, ScrollArea).
- [ ] **Task 3: Refactoring.** Target the main Chat Interface file (`AgentPanel.tsx`). Strip out the custom CSS classes and replace them with the standardized tokens and components established in Tasks 1 & 2.
- [ ] **Task 4: Layout & Polish.** Ensure the responsive breakpoints (mobile vs. desktop) match the Figma design's intent.
