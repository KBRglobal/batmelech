import pathlib,subprocess
logs=[]
for cmd in [['npm','--prefix','customer-site','test'],['npm','--prefix','customer-site','run','build'],['git','diff','--check']]:
 p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 logs.append(p.stdout)
 pathlib.Path('tasks/rosh-hashanah/evidence/build.txt').write_text('\n'.join(logs))
 print(p.stdout)
 if p.returncode:raise SystemExit(p.returncode)
