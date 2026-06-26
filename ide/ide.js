(function() {
  console.log('IDE: top-level, readyState=' + document.readyState + ', CodeMirror=' + typeof CodeMirror);

  const examples = [
    {
      name: 'Hello World',
      source: `; Minimal KolibriOS Hello World
; Self-contained, no external includes needed.
; Demonstrates: window creation, text drawing, event loop.
; Compile: FASM hello.asm hello.kex
use32
  org 0x0
  db 'MENUET01'
  dd 0x01
  dd start
  dd i_end
  dd 0x100000
  dd 0x7fff0
  dd 0
  dd 0

start:
  mov eax,12
  mov ebx,1
  int 0x40
  xor eax,eax
  mov ebx,150*65536+300
  mov ecx,150*65536+120
  mov edx,0x34000000
  mov edi,title
  int 0x40
  mov eax,12
  mov ebx,2
  int 0x40

wait:
  mov eax,10
  int 0x40
  dec eax
  jz wait
  dec eax
  jz wait
  or eax,-1
  int 0x40

title db 'Hello',0
i_end:`
    },
    {
      name: 'GUI Template',
      source: `; KolibriOS GUI Template
; Standard window with button and keyboard handling.
; Self-contained, no includes needed.
; Compile: FASM template.asm template.kex
use32
  org 0x0
  db 'MENUET01'
  dd 0x01
  dd start
  dd i_end
  dd 0x100000
  dd 0x7fff0
  dd 0
  dd 0

start:
  mov eax,48
  mov ebx,3
  mov ecx,sc
  mov edx,sizeof.system_colors
  int 0x40

redraw:
  call draw_window

wait_event:
  mov eax,10
  int 0x40
  dec eax
  jz redraw
  dec eax
  jz key
  dec eax
  jz button

key:
  mov al,2
  int 0x40
  jmp wait_event

button:
  mov al,17
  int 0x40
  cmp ah,1
  jne wait_event
  or eax,-1
  int 0x40

draw_window:
  mov eax,12
  mov ebx,1
  int 0x40
  xor eax,eax
  mov ebx,150*65536+300
  mov ecx,150*65536+120
  mov edx,[sc.work]
  or edx,0x33000000
  mov edi,title
  int 0x40
  mov eax,8
  mov ebx,170*65536+80
  mov ecx,60*65536+25
  mov edx,2
  mov esi,btn_str
  int 0x40
  mov eax,4
  mov ebx,10*65536+30
  mov ecx,0x80000000
  mov edx,text
  int 0x40
  mov eax,12
  mov ebx,2
  int 0x40
  ret

title db 'Template',0
text db 'Press the button to exit',0
btn_str db 'Exit',0

struct system_colors
  frame            dd ?
  grab             dd ?
  work_dark        dd ?
  work_light       dd ?
  grab_text        dd ?
  work             dd ?
  work_button      dd ?
  work_button_text dd ?
  work_text        dd ?
  work_graph       dd ?
ends

i_end:
sc system_colors`
    },
    {
      name: 'Text Demo',
      source: `; KolibriOS Text Drawing Demo
; Shows multiple text lines with different positions.
; Compile: FASM text.asm text.kex
use32
  org 0x0
  db 'MENUET01'
  dd 0x01
  dd start
  dd i_end
  dd 0x100000
  dd 0x7fff0
  dd 0
  dd 0

start:
  mov eax,12
  mov ebx,1
  int 0x40
  xor eax,eax
  mov ebx,100*65536+320
  mov ecx,100*65536+160
  mov edx,0x33000000
  mov edi,title
  int 0x40
  mov eax,4
  mov ebx,20*65536+30
  mov ecx,0x00ffffff
  mov edx,line1
  int 0x40
  mov ebx,20*65536+50
  mov edx,line2
  int 0x40
  mov ebx,20*65536+70
  mov edx,line3
  int 0x40
  mov eax,12
  mov ebx,2
  int 0x40

wait:
  mov eax,10
  int 0x40
  dec eax
  jz start
  dec eax
  jz wait
  or eax,-1
  int 0x40

title db 'Text Demo',0
line1 db 'Welcome to KolibriOS!',0
line2 db 'This is a text drawing demo.',0
line3 db 'Press any key to exit.',0
i_end:`
    },
    {
      name: 'Eyes Demo',
      source: `;
; EYES FOR MENUET
;
; Written by Nikita Lesnikov (nlo_one@mail.ru)
;
; Position of "eyes" is fixed. To close "eyes" just click on them.
;

TIMEOUT equ 3

; EXECUTABLE HEADER

use32

  org 0x0
  db "MENUET01"
  dd 0x01
  dd ENTRANCE
  dd EYES_END
  dd 0x3000
  dd 0x3000
  dd 0x0
  dd 0x0

include '..\\..\\..\\macros.inc'
ENTRANCE: ; start of code

; ==== main ====

call prepare_eyes

call shape_window

still:

call draw_eyes                   ; draw those funny "eyes"

mcall 23,TIMEOUT                 ; wait for event with timeout

cmp eax,1                        ; redraw ?
jnz  no_draw
call redraw_overlap
no_draw:

cmp eax,2                        ; key ?
jz  key

cmp eax,3                        ; button ?
jz  button

jmp still                        ; loop

; EVENTS

key:
mcall 2          ; just read and ignore
jmp still

button:          ; analyze button
mcall -1         ; exit
jmp still

; -====- declarations -====-

imagedata equ EYES_END
skindata  equ EYES_END+925
winref    equ EYES_END+6325

; -====- shape -====-

shape_window:

mov eax,50                   ; set up shape reference area
mov ebx,0
mov ecx,winref
mcall

ret

; -====- redrawing -====-

draw_eyes:                   ; check mousepos to disable blinking

mov eax,37
xor ebx,ebx
mcall
cmp dword [mouse],eax
jne redraw_ok
ret
redraw_ok:
mov [mouse],eax

redraw_overlap:              ; label for redraw event (without checkmouse)

mcall 12,1

xor eax,eax                  ; define window
mov ebx,[win_ebx]
mov ecx,[win_ecx]
mov edx,0x11000000           ; do not draw window, just define its area
xor esi,esi
xor edi,edi
mcall

mcall 8,60,45,1+0x40000000 ; define closebutton

mov ebx,skindata
mcall 7,,60*65536+30,15

mov eax,15
mov ebx,30
call draw_eye_point
add eax,30
call draw_eye_point

mcall 12,2

ret

draw_eye_point:          ; draw eye point (EAX=X, EBX=Y)
pusha

mov ecx, [mouse]    ; ecx = mousex, edx = mousey
mov edx,ecx
shr ecx,16
and edx,0xFFFF

; ===> calculate position

push eax
push ebx
mov byte [sign1],0
mov esi, [win_ebx]
shr esi,16
add eax,esi
sub ecx,eax                 ; ECX=ECX-EAX (signed) , ECX=|ECX|
jnc abs_ok_1
neg ecx
mov byte [sign1],1
abs_ok_1:
mov [temp1],ecx
mov byte [sign2],0
mov esi,[win_ecx]
shr esi,16
add ebx,esi
sub edx,ebx                 ; EDX=EDX-EBX (signed) , EDX=|EDX|
jnc abs_ok_2
neg edx
mov byte [sign2],1
abs_ok_2:
mov [temp2],edx
pop ebx
pop eax

push eax                    ; ECX*=ECX
push edx
xor eax,eax
xor edx,edx
mov ax,cx
mul cx
shl edx,16
or  eax,edx
mov ecx,eax
pop edx
pop eax

push eax                    ; EDX*=EDX
push ecx
mov  ecx,edx
xor  eax,eax
xor  edx,edx
mov  ax,cx
mul  cx
shl  edx,16
or   eax,edx
mov  edx,eax
pop  ecx
pop  eax

push ebx
push ecx
push edx
push eax
mov  ebx,ecx                 ; EBX=ECX+EDX
add  ebx,edx
xor  edi,edi                 ; ESI=SQRT(EBX)
mov  ecx,edi
mov  edx,edi
inc  edi
mov  eax,edi
inc  edi
sqrt_loop:
add  ecx,eax
add  eax,edi
inc  edx
cmp  ecx,ebx
jbe  sqrt_loop
dec  edx
mov  esi,edx
mov  ax,si                   ; ESI=ESI/7
mov  dl,7
div  dl
and  ax,0xFF
mov  si,ax                   ; ESI ? 0 : ESI=1
jnz  nozeroflag1
mov  si,1
nozeroflag1:

pop eax
pop edx
pop ecx
pop ebx

push eax                     ; ECX=[temp1]/ESI
push edx
mov  eax,[temp1]
mov  dx,si
div  dl
mov  cl,al
and  ecx,0xFF
pop  edx
pop  eax

cmp  byte [sign1],1
je   subtract_1
add  eax,ecx                  ; EAX=EAX+ECX
jmp  calc_ok_1
subtract_1:
sub  eax,ecx                  ; EAX=EAX-ECX
calc_ok_1:

push eax                      ; EDX=[temp2]/ESI
push ecx
mov  eax,[temp2]
mov  dx,si
div  dl
mov  dl,al
and  dx,0xFF
pop  ecx
pop  eax

cmp  byte [sign2],1
je   subtract_2
add  ebx,edx                  ; EBX=EBX+EDX
jmp  calc_ok_2
subtract_2:
sub  ebx,edx                  ; EBX=EBX-EDX
calc_ok_2:

; <===

mov ecx,ebx         ; draw point
mov ebx,eax
mov eax,13
dec ecx
dec ecx
dec ebx
dec ebx
shl ecx,16
add ecx,4
shl ebx,16
add ebx,4
mov eax,13
xor edx,edx
mcall

popa
ret

; -====- working on images and window -====-

prepare_eyes:

mov esi,imagedata+25 ; transform grayscale to putimage format
mov edi,skindata
mov ecx,30
transform_loop:
push ecx
mov  ecx,30
lp1:
lodsb
stosb
stosb
stosb
loop lp1
sub esi,30
mov  ecx,30
lp2:
lodsb
stosb
stosb
stosb
loop lp2
pop  ecx
loop transform_loop

mov eax,14           ; calculating screen position
mcall
shr eax,1
mov ax,59
sub eax,30*65536
mov [win_ebx],eax
mov [win_ecx],dword 10*65536+44

mov esi,imagedata+25 ; calculate shape reference area
mov edi,winref
mov ecx,900          ; disable drag bar
mov al,0
rep stosb

mov ecx,30           ; calculate circles for eyes
shape_loop:
push ecx

call copy_line       ; duplicate (we have two eyes :)
sub  esi,30
call copy_line

pop  ecx
loop shape_loop

ret

copy_line:       ; copy single line to shape reference area
mov ecx,30
cpl_loop:
lodsb
cmp al,0xFF
jnz  set_one
mov al,0
jmp cpl_ok
set_one:
mov al,1
cpl_ok:
stosb
loop cpl_loop
ret

; DATA

; environment

win_ebx  dd     0x0
win_ecx  dd     0x0
mouse    dd     0xFFFFFFFF

; temporary storage for math routines

temp1    dd     0
temp2    dd     0
sign1    db     0
sign2    db     0

EYES_END: ; end of code`
    }
  ];

  const exampleSelect = document.getElementById('exampleSelect');
  const compileRunBtn = document.getElementById('compileRunBtn');
  const statusEl = document.getElementById('status');

  let editor;
  let app;

  function initEditor() {
    console.log('IDE: initEditor start, CodeMirror=', typeof CodeMirror, 'defineSimpleMode=', typeof (CodeMirror && CodeMirror.defineSimpleMode));
    try {
      if (typeof CodeMirror !== 'function' || typeof CodeMirror.defineSimpleMode !== 'function') {
        statusEl.textContent = 'CodeMirror not available';
        console.log('IDE: CodeMirror unavailable');
        return false;
      }
      const builtins = new Set('org use32 use16 use64 align db dd dw dp dt rb rd rw rp rt include incbin macro end virtual repeat while if else match restore purge struc ends format section segment public extrn assume even times load store fixed float du ru rp display assert postpone namespace iterate rept irp irps calminstruction'.split(' '));
      const registers = new Set('eax ebx ecx edx esi edi esp ebp eip ax bx cx dx si di sp bp al ah bl bh cl ch dl dh sil dil bpl spl r8 r9 r10 r11 r12 r13 r14 r15 mm0 mm1 mm2 mm3 mm4 mm5 mm6 mm7 xmm0 xmm1 xmm2 xmm3 xmm4 xmm5 xmm6 xmm7 ymm0 ymm1 ymm2 ymm3 ymm4 ymm5 ymm6 ymm7 st0 st1 st2 st3 st4 st5 st6 st7 cr0 cr1 cr2 cr3 cr4 dr0 dr1 dr2 dr3 dr4 dr5 dr6 dr7'.split(' '));
      const instructions = new Set('mov add sub mul div imul idiv inc dec and or xor not neg shl shr sal sar rol ror rcl rcr push pop pusha popa pushf popf pushad popad call ret retf retn jmp je jne jz jnz jg jl jge jle ja jb jae jbe jo jno js jns jp jnp jcxz jecxz loop loope loopne int into int3 syscall sysenter sysexit cmp test xchg cmpxchg xadd bsf bsr lea nop hlt cli sti cld std cmc clc stc lahf sahf cbw cwd cdq cwde cdqe movsb movsw movsd movsq stosb stosw stosd stosq lodsb lodsw lodsd lodsq scasb scasw scasd scasq cmpsb cmpsw cmpsd cmpsq insb insw insd outsb outsw outsd rep repe repne repz repnz enter leave bound invlpg cpuid rdtsc rdtscp rdmsr wrmsr rdpmc in out fadd fsub fmul fdiv fcom fcomp fcompp fild fist fistp fld fst fstp fldz fld1 fldpi fchs fabs fsqrt frndint fpatan fptan fprem fprem1 f2xm1 fyl2x fyl2xp1 fscale fsin fcos fsincos fxch fxam fincstp fdecstp fstenv fldenv fsave frstor fstsw fstcw fldcw wait fnop fclex emms pause bswap bt bts btr btc sete setne setz setnz setg setl setge setle seta setb setae setbe seto setno sets setns'.split(' '));

      CodeMirror.defineSimpleMode('fasm', {
        start: [
          { regex: /;.*$/, token: 'comment' },
          { regex: /0x[0-9a-fA-F]+/, token: 'number' },
          { regex: /\d+/, token: 'number' },
          { regex: /'[^']*'/, token: 'string' },
          { regex: /"[^"]*"/, token: 'string' },
          { regex: /[a-zA-Z_.][\w.]*:/, token: 'tag' },
          {
            regex: /[a-zA-Z_.][\w.]*/,
            token: function(match) {
              var word = match[0].toLowerCase().replace(/\s+/g, '_');
              if (builtins.has(word)) return 'builtin';
              if (registers.has(word)) return 'variable-2';
              if (instructions.has(word)) return 'keyword';
              return 'variable';
            }
          }
        ],
        meta: { lineComment: ';' }
      });

      const editorEl = document.getElementById('editor');
      if (!editorEl) {
        statusEl.textContent = 'Editor element not found';
        return false;
      }

      editor = CodeMirror(editorEl, {
        value: '; KOS IDE\n; Select an example to begin.',
        mode: 'fasm',
        theme: 'monokai',
        lineNumbers: true,
        indentUnit: 2,
        tabSize: 2,
        matchBrackets: true,
        viewportMargin: Infinity
      });

      examples.forEach((ex, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = ex.name;
        exampleSelect.appendChild(opt);
      });

      exampleSelect.addEventListener('change', () => loadSource(parseInt(exampleSelect.value)));
      loadSource(0);
      return true;
    } catch (e) {
      statusEl.textContent = 'Editor init error: ' + e.message;
      return false;
    }
  }

  function connectApp() {
    app = window.__app;
    if (!app) {
      connectApp._retries = (connectApp._retries || 0) + 1;
      if (connectApp._retries > 100) {
        statusEl.textContent = 'Emulator offline';
        return;
      }
      setTimeout(connectApp, 100);
      return;
    }

    compileRunBtn.addEventListener('click', () => compileAndRun());

    if (!app.browserFsRoot) {
      mountBundledRoot();
    }

    statusEl.textContent = 'Ready. Assemble & Run to compile and execute.';
  }

  function init() {
    console.log('IDE: init, app=', !!window.__app, 'statusEl=', !!statusEl);
    const editorOk = initEditor();
    console.log('IDE: initEditor result:', editorOk);
    connectApp();
  }

  function loadSource(index) {
    const ex = examples[index];
    editor.setValue(ex.source);
    statusEl.textContent = 'Ready. Assemble & Run to compile and execute.';
  }

  async function compileAndRun() {
    statusEl.textContent = 'Compiling...';
    compileRunBtn.disabled = true;

    try {
      const source = editor.getValue();

      if (!app.browserFsRoot) {
        mountBundledRoot();
        if (!app.browserFsRoot) {
          throw new Error('No filesystem available');
        }
      }

      const encoder = new TextEncoder();
      const sourceBytes = encoder.encode(source);
      const srcResult = app.browserFsRoot.mutationProvider('create-file', '/tmp0/1/source.asm', { data: sourceBytes.buffer });
      app.log(`Write source result: ${JSON.stringify(srcResult)}`);

      if (!srcResult || srcResult.errorCode !== 0) {
        throw new Error(`Failed to write source (error ${srcResult ? srcResult.errorCode : '?'})`);
      }

      const paramsStr = '/tmp0/1/source.asm /tmp0/1/out.kex';
      app.log(`Launching FASM with params: "${paramsStr}"`);
      const launchResult = app.sessionManager.startApplication({
        path: '/develop/FASM',
        params: paramsStr
      });

      if (launchResult.errorCode !== 0) {
        throw new Error(`FASM launch failed (error ${launchResult.errorCode})`);
      }

      const pid = launchResult.pid;
      const kexBytes = await pollForOutput(pid, '/tmp0/1/out.kex', 30000);
      if (!kexBytes) {
        throw new Error('FASM did not produce output');
      }

      app.loadImageFromBuffer('compiled.kex', kexBytes.buffer, 'IDE');
      app.launchCurrentImage();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      app.log(`Compile error: ${err.message}`);
    } finally {
      compileRunBtn.disabled = false;
    }
  }

  function pollForOutput(pid, outPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const poll = () => {
        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        const proc = app.sessionManager.processByPid.get(pid);
        if (!proc || proc.removed) {
          const bytes = app.browserFsRoot.fileProvider(outPath);
          resolve(bytes || null);
          return;
        }
        setTimeout(poll, 100);
      };
      setTimeout(poll, 100);
    });
  }

  function mountBundledRoot() {
    const KosEmu = globalThis.KosEmu;
    const manifest = (KosEmu.assets || {}).builtinKolibriRoot;
    const bundledRoot = KosEmu.ui.bundledRoot;
    if (!manifest || !bundledRoot || typeof bundledRoot.createBundledRoot !== 'function') {
      app.log('Bundled root unavailable for IDE');
      return;
    }
    try {
      const root = bundledRoot.createBundledRoot(manifest);
      app.browserFsRoot = root;
      app.savedFsRootLabel = '';
      app.savedFsRootPendingPermission = false;
      if (typeof app.updateFsRootStatus === 'function') app.updateFsRootStatus();
      if (typeof app.updateSessionState === 'function') app.updateSessionState();
      app.log('Mounted built-in FS root for IDE.');
    } catch (err) {
      app.log(`Failed to mount built-in root: ${err.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
