; Minimal KolibriOS Hello World
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
i_end:
