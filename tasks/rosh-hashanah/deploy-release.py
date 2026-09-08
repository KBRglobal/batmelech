import subprocess,json,pathlib,time
root=pathlib.Path(__file__).resolve().parents[2]
def run(*cmd):return subprocess.run(cmd,cwd=root,check=True,capture_output=True,text=True).stdout.strip()
review=root/'tasks/rosh-hashanah/evidence/release-review.md'
assert review.exists() and 'Resolved' in review.read_text(), 'Review must be resolved before release'
run('git','fetch','origin','main')
assert run('git','branch','--show-current')=='main'
assert run('git','rev-parse','HEAD')==run('git','rev-parse','origin/main'), 'Remote changed; reconcile before release'
paths=['shared','customer-site/src','customer-site/public/sitemap.xml','web/src','server.js','server/site-order-route.js','server/domain/order-pricing.js','server/ai/site-knowledge.js','site','tests/rosh-hashanah.test.js','tests/order-pricing.test.js','tests/site-order-route.test.js']
run('git','add','--',*paths)
# Save task sources; generated screenshots and local evidence stay out of Git.
sourcefiles=[str(p.relative_to(root)) for p in (root/'tasks/rosh-hashanah').iterdir() if p.is_file()]
run('git','add','--',*sourcefiles)
run('git','diff','--cached','--check')
changed=run('git','diff','--cached','--name-only').splitlines()
assert changed and all(not p.startswith('tasks/rosh-hashanah/evidence') for p in changed)
run('git','commit','-m','Add festive Rosh Hashanah packages with shared customer and admin billing')
commit=run('git','rev-parse','HEAD')
run('git','push','origin','main')
report={'commit':commit,'files':changed,'pushed':True}
evidence=root/'tasks/rosh-hashanah/evidence/release.json';evidence.write_text(json.dumps(report,indent=2))
for attempt in range(35):
 status=json.loads(run('railway','status','--json'))
 app=next(s['node'] for e in status['environments']['edges'] for s in e['node']['serviceInstances']['edges'] if s['node']['serviceName']=='app')
 d=app['latestDeployment'];deployed=(d.get('meta') or {}).get('commitHash')
 print('Deployment',d.get('status'),'matches commit',deployed==commit,flush=True)
 if deployed==commit:
  report['deployment']={'id':d['id'],'status':d['status'],'commit':deployed};evidence.write_text(json.dumps(report,indent=2))
  if d['status']=='SUCCESS':break
  if d['status'] in ['FAILED','CRASHED','REMOVED']:raise RuntimeError('Production deployment failed')
 time.sleep(12)
else:raise RuntimeError('Deployment did not become successful in time')
assert run('git','rev-parse','origin/main')==commit
