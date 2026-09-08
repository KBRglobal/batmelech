import subprocess,pathlib
out=pathlib.Path('tasks/rosh-hashanah/evidence/admin-tests.txt')
commands=[['node','--test','tests/rosh-hashanah.test.js','tests/order-pricing.test.js','tests/site-order-route.test.js','tests/server-security.test.js'],['npm','--prefix','web','test'],['npm','--prefix','customer-site','test'],['npx','--yes','--package=node@20.20.2','node','--test','tests/order-pricing.test.js','tests/site-order-route.test.js']]
with out.open('w') as f:
 for cmd in commands:
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  f.write(' '.join(cmd)+'\n'+r.stdout+'\n');f.flush()
  print(' '.join(cmd),r.returncode)
  if r.returncode: print(r.stdout[-10000:]);raise SystemExit(r.returncode)
