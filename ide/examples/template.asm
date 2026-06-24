; KolibriOS GUI Template
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
sc system_colors
