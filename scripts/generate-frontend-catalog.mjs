// Fixed contracts derived from guarded page loaders and explicit Server Actions.
// Source changes require regenerating and reviewing this checked-in catalog.
import ts from 'typescript';
import { frontendSourceHash } from './frontend-source-hash.mjs';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const walk = d => readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]).sort();
const readSource = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const readers=[],actions=[],pages=[];
const outputs={};
const hasJsx = node => {let found=false; const visit=n=>{if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);};visit(node);return found;};
const identifiers = node => {const names=new Set();const visit=n=>{if(ts.isIdentifier(n))names.add(n.text);ts.forEachChild(n,visit);};visit(node);return names;};
const bindings = node => {if(ts.isIdentifier(node))return [node.text];if(ts.isObjectBindingPattern(node)||ts.isArrayBindingPattern(node))return node.elements.flatMap(e=>ts.isBindingElement(e)?bindings(e.name):[]);return [];};
// Keep only imports referenced by the generated function; no UI imports on the backend.
function importsFor(sf, body){const ids=identifiers(ts.createSourceFile('body.tsx',body,99,true,4));return sf.statements.filter(ts.isImportDeclaration).flatMap(n=>{
 if(!n.importClause)return [];
 const clause=n.importClause, parts=[];
 if(clause.name&&ids.has(clause.name.text))parts.push(clause.name.text);
 const b=clause.namedBindings;
 if(b&&ts.isNamedImports(b)){const names=b.elements.filter(e=>ids.has(e.name.text)).map(e=>e.getText(sf));if(names.length)parts.push(`{ ${names.join(', ')} }`);}
 if(b&&ts.isNamespaceImport(b)&&ids.has(b.name.text))parts.push(b.getText(sf));
 if(!parts.length)return [];
 let modulePath=n.moduleSpecifier.text;
 if(modulePath.startsWith('.'))modulePath='@/'+path.posix.normalize(path.posix.join(path.posix.dirname(sf.fileName),modulePath));
 return [`import ${clause.isTypeOnly?'type ':''}${parts.join(', ')} from ${JSON.stringify(modulePath)};`];
 }).join('\n');}
for(const file of walk('app').filter(f=>/\/(page|layout)\.tsx$/.test(f)&&f!=='app/layout.tsx')){
 const source=readSource(file),sf=ts.createSourceFile(file,source,99,true,4),edits=[];
 for(const fn of sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.body&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))){
  const isDefault=fn.modifiers.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword);
  if(!isDefault&&fn.name?.text!=='generateMetadata')continue;
  const index=fn.body.statements.findIndex(hasJsx);
  const prefix=index<0?[...fn.body.statements]:fn.body.statements.slice(0,index);
  if(!prefix.length)continue;
  // Move all statements before rendering, preserving early navigation and guards.
  const suffix=index<0?'':source.slice(fn.body.statements[index].getStart(sf),fn.body.end-1);
  const used=identifiers(ts.createSourceFile('suffix.tsx',suffix,99,true,4));
  const functionVars=prefix.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations.filter(d=>d.initializer && (ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer))).map(d=>({name:d.name.getText(sf), source:s.getText(sf)})));
  for (const fn of functionVars.filter(f=>used.has(f.name))) for (const name of identifiers(ts.createSourceFile('closure.ts',fn.source,99,true))) used.add(name);
  const localParams = prefix.filter(ts.isVariableStatement).filter(s => s.declarationList.declarations.every(d => d.initializer && ts.isAwaitExpression(d.initializer) && ['params','searchParams'].includes(d.initializer.expression.getText(sf))));
  const paramNames = new Set(localParams.flatMap(s=>s.declarationList.declarations.flatMap(d=>bindings(d.name))));
  const returnedNames=prefix.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations.flatMap(d=>bindings(d.name))).filter(n=>used.has(n)&&!paramNames.has(n)&&!functionVars.some(f=>f.name===n));
  // Parameters (e.g. layout children) remain local; only route/query input crosses hosts.
  const params=fn.parameters.map(p=>p.getText(sf)).join(', ');
  const slug=file.replace(/^app\//,'').replace(/\.tsx$/,'').replace(/[^a-zA-Z0-9]+/g,'-');
  const name=`load${fn.name?.text??'Page'}`,modulePath=`lib/views/generated/${slug}-${name}`;
  const helpers=sf.statements.filter(n=>!ts.isImportDeclaration(n)&&!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&!hasJsx(n)).map(n=>n.getText(sf)).join('\n');
  const inputPrefix=prefix.map(s=>s.getText(sf)).join('\n');
  const body=`${helpers}\nexport async function ${name}(${params}) {\n${inputPrefix}\n${index<0?'':`return viewDto({ ${returnedNames.join(', ')} } as const);`}\n}`;
  outputs[`${modulePath}.ts`]=`// Generated from ${file}; regenerate with npm run frontend:catalog.\nimport "server-only";\nimport { viewDto } from "@/lib/frontend/view";\n${importsFor(sf,body)}\n${body}\n`;
  readers.push({module:modulePath,name,id:`${slug}:${name}`});
  const args=fn.parameters.length? '[{ '+(params.includes('params')?'params, ':'')+(params.includes('searchParams')?'searchParams':'')+' }]':'[]';
  const nullable = prefix.some(n => /return\s+null/.test(n.getText(sf)));
  const read = `await invokeBackend<Views[${JSON.stringify(`${slug}:${name}`)}]>("view", ${JSON.stringify(`${slug}:${name}`)}, ${args})`;
  const replacement = index < 0 ? `return ${read};` : `${localParams.map(s=>s.getText(sf)).join("\n")}\n${nullable ? `const loaded = ${read};\nif (loaded === null) return null;\nconst { ${returnedNames.join(', ')} } = loaded;` : `const { ${returnedNames.join(', ')} } = ${read};`}\n${functionVars.filter(f=>used.has(f.name)).map(f=>f.source).join("\n")}\n${suffix}`;
  edits.push({start:fn.body.getStart(sf)+1,end:fn.body.end-1,text:replacement});
 }
 if(edits.length){let generated=source;for(const e of edits.reverse())generated=generated.slice(0,e.start)+e.text+generated.slice(e.end);pages.push({file,source:'import type { Views } from "@/contracts";\nimport { invokeBackend } from "@/lib/frontend/client";\n'+generated});}
}
for(const file of walk('app/actions').filter(f=>f.endsWith('.ts')).sort()){
 const sf=ts.createSourceFile(file,readSource(file),99,true);
 for(const n of sf.statements){if(ts.isFunctionDeclaration(n)&&n.name&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&n.modifiers.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))actions.push({module:file.slice(0,-3),name:n.name.text,id:`${path.basename(file,'.ts')}:${n.name.text}`});}
}
for (const name of ['loadApprovalInbox', 'loadGithubPullRequests']) readers.push({module:'lib/views/components',name,id:`components:${name}`});
const all=[...readers,...actions];
outputs['lib/frontend/registry.ts']=`// Generated fixed endpoint allowlist.\nimport "server-only";\n${all.map((x,i)=>`import { ${x.name} as endpoint${i} } from "@/${x.module}";`).join('\n')}\nexport const viewReaders = Object.freeze({\n${readers.map(x=>`${JSON.stringify(x.id)}: endpoint${all.indexOf(x)},`).join('\n')}\n});\nexport const backendActions = Object.freeze({\n${actions.map(x=>`${JSON.stringify(x.id)}: endpoint${all.indexOf(x)},`).join('\n')}\n});\n`;
const escapeSegment = segment => [...segment].map(char => '.+*?^$()[]{}|\\'.includes(char) ? '\\' + char : char).join('');
const resources = walk('app').filter(f => f.endsWith('/route.ts') && !f.startsWith('app/api/')).map(f => '/' + f.slice(4,-9).split('/').filter(Boolean).map(segment => segment.startsWith('[') ? '[^/]+' : escapeSegment(segment)).join('/'));
outputs['lib/frontend/resources.ts'] = '// Generated exact resource route allowlist.\nexport const resourcePaths = ' + JSON.stringify(resources) + '.map(path => new RegExp("^" + path + "/?$"));\n';
outputs['frontend/catalog.json']=JSON.stringify({readers,actions},null,2)+'\n';
// Rendering templates are generated by the same reviewed transform.
outputs['frontend/pages.json']=JSON.stringify(pages,null,2)+'\n';
for(const [file,text] of Object.entries(outputs)){
 if(process.argv.includes('--check')){if(readSource(file)!==text)throw new Error(`Stale frontend contract: ${file}`);}
 else {mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,text);}
}
console.log(`Frontend catalog: ${readers.length} guarded views, ${actions.length} actions.`);

if (process.argv.includes('--check') && !readFileSync('frontend/contracts.d.ts','utf8').includes('// Source SHA256: ' + frontendSourceHash())) throw new Error('Frontend DTO types are stale. Run npm run frontend:catalog.');
