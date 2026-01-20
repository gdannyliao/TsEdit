# Optimize Deno Compile with pkg Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce binary size from 171MB to 30-50MB by migrating from Deno compile to Node.js pkg packaging.

**Architecture:** Replace Deno compilation with TypeScript → CommonJS compilation → pkg packaging workflow. Remove Node.js compatibility layer (`node:` imports) and clean up redundant dependencies.

**Tech Stack:** TypeScript, tsc, pkg, Node.js

---

### Task 1: Remove redundant dependency (node-uuid)

**Files:**
- Modify: `package.json`

**Step 1: Remove node-uuid from dependencies**

Remove `"node-uuid": "^1.4.8"` from the dependencies section.

**Step 2: Update package.json**

Edit `package.json` to remove the node-uuid line:
```json
"dependencies": {
  "uuid": "^11.1.0",
  "seedrandom": "^3.0.5",
  "ts-node": "^10.9.2",
  "yargs": "^18.0.0"
}
```

**Step 3: Run npm install to clean up**

Run: `npm install`
Expected: node_modules cleaned, no node-uuid

**Step 4: Verify removal**

Run: `ls node_modules | grep uuid`
Expected: Only "uuid" present, no "node-uuid"

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "refactor: remove unused node-uuid dependency"
```

---

### Task 2: Remove type: module from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove type: module line**

Remove `"type": "module",` line from package.json.

**Step 2: Verify package.json**

The top-level object should no longer have a "type" property.

**Step 3: Commit**

```bash
git add package.json
git commit -m "refactor: remove type: module for CommonJS migration"
```

---

### Task 3: Update tsconfig.json for CommonJS

**Files:**
- Modify: `tsconfig.json`

**Step 1: Replace tsconfig.json content**

Replace entire file with:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["src/**/*"]
}
```

**Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "refactor: update tsconfig for CommonJS output"
```

---

### Task 4: Remove node: prefix from src/index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Update imports in src/index.ts**

Replace all imports with `node:` prefix:
```typescript
// Line 1: import path from "node:path" → import path from "path"
// Line 4: import { existsSync, readFileSync } from "node:fs" → import { existsSync, readFileSync } from "fs"
// Line 6: import process from "node:process" → import process from "process"
// Line 7: import * as fs from 'node:fs/promises' → import * as fs from 'fs/promises'
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "refactor: remove node: prefix from imports"
```

---

### Task 5: Remove node: prefix from src/CodeScanner.ts

**Files:**
- Modify: `src/CodeScanner.ts`

**Step 1: Update import in src/CodeScanner.ts**

Replace:
```typescript
// Line 2: import { existsSync, mkdirSync } from "node:fs"
→ import { existsSync, mkdirSync } from "fs"
```

**Step 2: Commit**

```bash
git add src/CodeScanner.ts
git commit -m "refactor: remove node: prefix from imports"
```

---

### Task 6: Remove node: prefix from src/InvokeGraph.ts

**Files:**
- Modify: `src/InvokeGraph.ts`

**Step 1: Update import in src/InvokeGraph.ts**

Replace:
```typescript
// Line 1: import { writeFileSync } from "node:fs"
→ import { writeFileSync } from "fs"
```

**Step 2: Commit**

```bash
git add src/InvokeGraph.ts
git commit -m "refactor: remove node: prefix from imports"
```

---

### Task 7: Remove node: prefix from src/CocosInvokeGraph.ts

**Files:**
- Modify: `src/CocosInvokeGraph.ts`

**Step 1: Update import in src/CocosInvokeGraph.ts**

Replace:
```typescript
// Line 1: import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
→ import { readdirSync, readFileSync, writeFileSync } from 'fs'
```

**Step 2: Commit**

```bash
git add src/CocosInvokeGraph.ts
git commit -m "refactor: remove node: prefix from imports"
```

---

### Task 8: Remove node: prefix from src/TsObfusBuilder.ts

**Files:**
- Modify: `src/TsObfusBuilder.ts`

**Step 1: Update import in src/TsObfusBuilder.ts**

Replace:
```typescript
// Line 4: import * as path from "node:path"
→ import * as path from "path"
```

**Step 2: Commit**

```bash
git add src/TsObfusBuilder.ts
git commit -m "refactor: remove node: prefix from imports"
```

---

### Task 9: Add pkg to devDependencies

**Files:**
- Modify: `package.json`

**Step 1: Install pkg**

Run: `npm install --save-dev pkg`
Expected: pkg added to devDependencies

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add pkg as dev dependency"
```

---

### Task 10: Add build and package scripts to package.json

**Files:**
- Modify: `package.json`

**Step 1: Update scripts section**

Add these scripts to the "scripts" object:
```json
"build": "tsc",
"package": "pkg . --targets node18-macos-x64 --output bin/tsedit",
"package:all": "pkg . --targets node18-macos-x64,node18-linux-x64,node18-win-x64 --output bin/tsedit",
"package:mac": "pkg . --targets node18-macos-x64 --output bin/tsedit"
```

**Step 2: Add pkg configuration**

Add pkg config object to package.json (at the same level as scripts):
```json
"pkg": {
  "scripts": ["dist/**/*.js"],
  "assets": []
}
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "build: add build and package scripts with pkg configuration"
```

---

### Task 11: Update .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add dist and bin to .gitignore**

Add these lines to `.gitignore`:
```
dist/
bin/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add dist and bin to .gitignore"
```

---

### Task 12: Test TypeScript compilation

**Files:**
- None (test only)

**Step 1: Run build**

Run: `npm run build`
Expected: dist/ directory created with compiled .js and .d.ts files

**Step 2: Verify output**

Run: `ls -la dist/`
Expected: List of .js and .d.ts files

**Step 3: Check for compilation errors**

Ensure no TypeScript compilation errors in output.

---

### Task 13: Test pkg packaging

**Files:**
- None (test only)

**Step 1: Run package command**

Run: `npm run package`
Expected: bin/tsedit executable created

**Step 2: Check file size**

Run: `du -h bin/tsedit`
Expected: Size between 30-50MB

**Step 3: Make executable executable (if needed)**

Run: `chmod +x bin/tsedit`

**Step 4: Test executable**

Run: `./bin/tsedit --version`
Expected: Version displayed (2.0.2)

---

### Task 14: Verify functionality with actual project

**Files:**
- None (integration test)

**Step 1: Run tsedit on test project**

Run: `./bin/tsedit --project /path/to/test/project --rename`
Expected: Program runs without errors

**Step 2: Verify output**

Check that the obfuscation was applied correctly to the test project.

**Step 3: Compare with Deno version**

Ensure the output is functionally equivalent to the original Deno-compiled version.

---

### Task 15: Clean up old Deno binary

**Files:**
- Delete: `tsedit` (root directory)

**Step 1: Remove old binary**

Run: `rm tsedit`
Expected: Old Deno-compiled binary removed

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old Deno-compiled binary"
```

---

### Task 16: Update documentation

**Files:**
- Modify: `readme.md` (if exists)

**Step 1: Add build instructions**

Update readme with:
```markdown
## Building

### Compile TypeScript
```bash
npm run build
```

### Package as executable

For current platform (macOS):
```bash
npm run package
```

For all platforms:
```bash
npm run package:all
```

The packaged executable will be in `bin/tsedit`.
```

**Step 2: Commit**

```bash
git add readme.md
git commit -m "docs: add build and package instructions"
```

---

## Testing Checklist

After implementation:

- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] pkg successfully creates binary (`npm run package`)
- [ ] Binary size is 30-50MB (down from 171MB)
- [ ] Binary executes and shows version (`./bin/tsedit --version`)
- [ ] Full obfuscation workflow works on test project
- [ ] Output matches original Deno version functionality
- [ ] `dist/` and `bin/` are in `.gitignore`
- [ ] Old `tsedit` binary removed
