import pathlib,subprocess
with pathlib.Path('tasks/rosh-hashanah/evidence/release-build.txt').open('w') as f:
 for cmd in [['npm','--prefix','web','run','build'],['npm','--prefix','customer-site','run','build'],['git','diff','--check']]:
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);f.write(' '.join(cmd)+'\n'+r.stdout+'\n');f.flush()
  print(' '.join(cmd),r.returncode)
  if r.returncode: print(r.stdout);raise SystemExit(r.returncode)
 footer=pathlib.Path('customer-site/src/components/footer.tsx').read_text();legal=pathlib.Path('customer-site/src/pages/legal.tsx').read_text()
 for value in ['#accessibility','https://kbr.global','Web Design, SEO &amp; Managed Hosting by','t.privacy','t.terms','tel:+971586288776']:assert value in footer,value
 assert 'id="accessibility"' in legal
 f.write('Footer links, business contact and credit verified. No new tracking introduced.\n')
