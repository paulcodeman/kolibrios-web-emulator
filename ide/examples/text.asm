; KolibriOS Text Drawing Demo
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
i_end:
