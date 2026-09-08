import pathlib,json,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2]
def run(*args):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True).stdout.strip()
review=root/'tasks/rosh-hashanah/evidence/mobile-review.md';assert review.exists() and 'PASS' in review.read_text(), 'Review must pass'
run('git','fetch','origin','main');assert run('git','rev-parse','HEAD')==run('git','rev-parse','origin/main'),'Remote drift'
paths=['customer-site/src/pages/rosh-hashanah.tsx','customer-site/src/index.css','site','tasks/rosh-hashanah']
# Stage only task sources, never local screenshots or evidence.
run('git','add','--',*paths[:3],*[str(p.relative_to(root)) for p in (root/'tasks/rosh-hashanah').iterdir() if p.is_file()])
run('git','diff','--cached','--check');run('git','commit','-m','Clarify complete holiday packages on mobile without changing desktop')
commit=run('git','rev-parse','HEAD');run('git','push','origin','main');report={'commit':commit,'pushed':True}
out=root/'tasks/rosh-hashanah/evidence/mobile-release.json';out.write_text(json.dumps(report,indent=2))
for _ in range(35):
 status=json.loads(run('railway','status','--json'));app=next(s['node'] for e in status['environments']['edges'] for s in e['node']['serviceInstances']['edges'] if s['node']['serviceName']=='app');d=app['latestDeployment']
 if (d.get('meta')or{}).get('commitHash')==commit:
  report['deployment']={'id':d['id'],'status':d['status']};out.write_text(json.dumps(report,indent=2))
  if d['status']=='SUCCESS':break
  assert d['status'] not in ['FAILED','CRASHED','REMOVED'], 'Deploy failed'
 time.sleep(12)
else:raise RuntimeError('Deploy timeout')
result=json.loads(run('node','tasks/rosh-hashanah/mobile-clarity-live.cjs'));report['live']=result;out.write_text(json.dumps(report,indent=2));print(json.dumps(report))
