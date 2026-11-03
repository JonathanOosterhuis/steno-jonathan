import ast,logging,re
from pathlib import Path
s=(Path(__file__).resolve().parents[1] / 'src/transcriber.py').read_text();tree=ast.parse(s)
node=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='_drop_multi_segment_bleed')
ns={'re':re,'logger':logging.getLogger('test'),'_segment_rms':lambda path,a,b: .1 if path=='mic' else .8}
exec(compile(ast.Module(body=[node],type_ignores=[]),'correction','exec'),ns);fn=ns[node.name]
def seg(text,start,end):return dict(text=text,start=start,end=end)
m=seg('okay so just give me some minutes that I can merge these two together and then we can proceed but then I have also an error regarding putting the JSON file in git',10,30)
y=[seg('Okay so just give me some minutes that I can merge these two together and then we can proceed',10,20),seg('But then I have also an error regarding putting the JSON file in git',20,30)]
assert fn([m],y,'mic','sys')==[]
local=seg('I changed the prompt and fixed another problem yesterday',10,20)
assert fn([local],y,'mic','sys')==[local]
short=seg('yeah okay do not worry',10,13)
assert fn([short],[short],'mic','sys')==[short]
assert fn([m],y,None,None)==[m]
ns['_segment_rms']=lambda p,a,b:0
assert fn([m],y,'mic','sys')==[m]
ns['_segment_rms']=lambda p,a,b:1 if p=='mic' else .1
assert fn([m],y,'mic','sys')==[m]
print('6 checks passed: split echo, distinct speech, short reply, missing audio, unreadable audio, stronger microphone.')
