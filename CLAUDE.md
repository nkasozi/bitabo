# CLAUDE.md - Bitabo Svelte Project Guidelines

## Commands
- Build: `npm run build`
- Dev server: `npm run dev`
- Preview: `npm run preview`
- Lint: `npm run lint` (Prettier check)
- Format: `npm run format` (Prettier write)
- Type check: `npm run check`
- Tests:
  - All tests: `npm run test`
  - Unit tests: `npm run test:unit`
  - Single unit test: `npm run test:unit -- -t "test name"`
  - E2E tests: `npm run test:e2e`

## Code Style
- Use TypeScript with strict mode
- Tabs for indentation, single quotes for strings
- Max line length: 100 characters
- No trailing commas
- Component file naming: PascalCase.svelte
- Use $lib path alias for imports from src/lib
- Svelte 5 runes syntax ($props, etc.)
- Tailwind for styling with proper plugin configuration
- Modularize components and follow SvelteKit routing conventions
- Strong typing: avoid any, use proper interfaces/types
- Errors: use try/catch blocks with appropriate error handling
- Follow existing file patterns for new code
- Use small, testable methods that accept state as parameters and return values, rather than using functions that operate on global state
- Always include type annotations and return types for all functions and variables
- Use descriptive, well-named variables and methods that clearly indicate their purpose (e.g., preferred_address_length over pref_len)
- Avoid comments in favor of helper methods or descriptive intermediate variables
- Favor functional programming patterns over unnecessary OOP classes/inheritance
- Structure code to flow like a story - start with an overview, then helper functions like chapters, and finally a climax where results are displayed