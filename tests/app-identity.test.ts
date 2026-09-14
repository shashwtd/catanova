import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Conditional JSX slots are still siblings, even when many empty slots separate them. */
function siblingKeyCollisions(source: string): string[] {
  const file = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const collisions: string[] = [];
  function renderedElement(node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
    if (ts.isJsxElement(node)) return node.openingElement;
    if (ts.isJsxSelfClosingElement(node)) return node;
    if (ts.isJsxExpression(node) && node.expression) return renderedElement(node.expression);
    if (ts.isParenthesizedExpression(node)) return renderedElement(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return renderedElement(node.right);
  }
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const keys = new Map<string, string>();
      for (const child of node.children) {
        const element = renderedElement(child);
        const key = element?.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'key',
        );
        if (!element || !key?.initializer) continue;
        const identity = key.initializer.getText(file);
        const component = element.tagName.getText(file);
        const previous = keys.get(identity);
        if (previous) collisions.push(`${previous} and ${component} share ${identity}`);
        keys.set(identity, component);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return collisions;
}

test('the identity audit catches conditional hub/drawer collisions across empty child slots', () => {
  const source = `<main>
    {playerHome && <PlayerHub key={auth.account?.id} />}
    {entering && <Loading />}
    {room && <Lobby />}
    {panel === 'friends' && <FriendsDrawer key={auth.account?.id} />}
  </main>`;
  assert.deepEqual(siblingKeyCollisions(source), [
    'PlayerHub and FriendsDrawer share {auth.account?.id}',
  ]);
});

test('application screens and overlays never reuse the same sibling identity', () => {
  const source = readFileSync('apps/client/src/main.tsx', 'utf8');
  assert.deepEqual(siblingKeyCollisions(source), []);
});
