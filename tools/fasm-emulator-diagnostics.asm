use32
org 0

if ~ defined DIAG_LOOP_SCALE
  LOOP_SCALE equ 1
else
  LOOP_SCALE equ DIAG_LOOP_SCALE
end if

if ~ defined DIAG_BENCH_ROUNDS
  BENCH_ROUNDS equ 3
else
  BENCH_ROUNDS equ DIAG_BENCH_ROUNDS
end if

PHASE_REG32      equ 1
PHASE_MEM32      equ 2
PHASE_BYTE       equ 3
PHASE_STRING     equ 4
PHASE_BRANCH     equ 5
PHASE_GENERIC    equ 6
PHASE_SYSCALL    equ 7
PHASE_COUNT      equ 7
PHASE_DONE       equ 0FFFFFFFFh

BENCH_STATE      equ 010000h
BENCH_MAGIC0     equ BENCH_STATE + 0
BENCH_MAGIC1     equ BENCH_STATE + 4
BENCH_VERSION    equ BENCH_STATE + 8
BENCH_PHASE      equ BENCH_STATE + 12
BENCH_ROUND_PTR  equ BENCH_STATE + 16
BENCH_CHECKSUM   equ BENCH_STATE + 20
BENCH_FLAGS      equ BENCH_STATE + 24
BENCH_RESULT_BASE equ BENCH_STATE + 0100h

MEM32_SRC        equ 020000h
MEM32_DST        equ 024000h
MEM32_LIMIT      equ 027000h
BYTE_SRC         equ 028000h
BYTE_DST         equ 02A000h
BYTE_LIMIT       equ 02B000h
STRING_SRC       equ 02C000h
STRING_DST       equ 034000h
STRING_LIMIT     equ 03C000h
XLAT_TABLE       equ 03C000h
MEM_LIMIT        equ 040000h
STACK_TOP        equ 00F000h

REG32_ITER_BASE   equ 280000
MEM32_ITER_BASE   equ 160000
BYTE_ITER_BASE    equ 160000
STRING_ITER_BASE  equ 120000
BRANCH_ITER_BASE  equ 220000
GENERIC_ITER_BASE equ 260000
SYSCALL_ITER_BASE equ 80000

REG32_ITER   equ REG32_ITER_BASE * LOOP_SCALE
MEM32_ITER   equ MEM32_ITER_BASE * LOOP_SCALE
BYTE_ITER    equ BYTE_ITER_BASE * LOOP_SCALE
STRING_ITER  equ STRING_ITER_BASE * LOOP_SCALE
BRANCH_ITER  equ BRANCH_ITER_BASE * LOOP_SCALE
GENERIC_ITER equ GENERIC_ITER_BASE * LOOP_SCALE
SYSCALL_ITER equ SYSCALL_ITER_BASE * LOOP_SCALE

db 'MENUET01'
dd 1
dd START
dd I_END
dd MEM_LIMIT
dd STACK_TOP
dd 0
dd 0

START:
  call init_bench_state
  call init_buffers
  mov dword [BENCH_ROUND_PTR], 0

round_loop:
  mov eax, [BENCH_ROUND_PTR]
  cmp eax, BENCH_ROUNDS
  jae near benchmark_done

  call phase_reg32
  call phase_mem32
  call phase_byte
  call phase_string
  call phase_branch
  call phase_generic
  call phase_syscall

  inc dword [BENCH_ROUND_PTR]
  jmp round_loop

benchmark_done:
  mov dword [BENCH_PHASE], PHASE_DONE
  mov eax, -1
  int 40h

phase_reg32:
  mov dword [BENCH_PHASE], PHASE_REG32
  mov ecx, REG32_ITER
  mov eax, 11223344h
  mov ebx, 55667788h
  mov edx, 01020304h
  mov esi, 7F00FF00h
phase_reg32_loop:
  add eax, ebx
  xor ebx, edx
  sub edx, esi
  or esi, eax
  and eax, 7FFFFFFFh
  lea esi, [esi + eax + 4]
  xor edx, ebx
  add ebx, 1234567h
  dec ecx
  jnz phase_reg32_loop
  xor eax, ebx
  xor eax, edx
  xor eax, esi
  mov ebx, PHASE_REG32
  call store_phase_result
  ret

phase_mem32:
  mov dword [BENCH_PHASE], PHASE_MEM32
  mov ecx, MEM32_ITER
  mov esi, MEM32_SRC
  mov edi, MEM32_DST
phase_mem32_loop:
  mov eax, [esi]
  add eax, [esi + 4]
  xor eax, [esi + 8]
  sub eax, [esi + 12]
  mov [edi], eax
  add esi, 16
  add edi, 16
  cmp esi, MEM32_LIMIT
  jb near phase_mem32_continue
  mov esi, MEM32_SRC
  mov edi, MEM32_DST
phase_mem32_continue:
  dec ecx
  jnz phase_mem32_loop
  mov eax, [MEM32_DST]
  mov ebx, PHASE_MEM32
  call store_phase_result
  ret

phase_byte:
  mov dword [BENCH_PHASE], PHASE_BYTE
  mov ecx, BYTE_ITER
  mov esi, BYTE_SRC
  mov edi, BYTE_DST
  mov ebx, XLAT_TABLE
phase_byte_loop:
  mov al, [esi]
  xlatb
  mov [edi], al
  movzx edx, byte [esi + 1]
  movsx eax, byte [edi + 1]
  xor dl, al
  mov [edi + 1], dl
  add eax, edx
  add esi, 3
  add edi, 3
  cmp esi, BYTE_LIMIT
  jb near phase_byte_continue
  mov esi, BYTE_SRC
  mov edi, BYTE_DST
phase_byte_continue:
  dec ecx
  jnz phase_byte_loop
  movzx eax, byte [BYTE_DST]
  mov ebx, PHASE_BYTE
  call store_phase_result
  ret

phase_string:
  mov dword [BENCH_PHASE], PHASE_STRING
  mov ecx, STRING_ITER
  cld
  mov esi, STRING_SRC
  mov edi, STRING_DST
phase_string_loop:
  lodsd
  xor eax, 55AA55AAh
  stosd
  cmp esi, STRING_LIMIT
  jb near phase_string_continue
  mov esi, STRING_SRC
  mov edi, STRING_DST
phase_string_continue:
  dec ecx
  jnz phase_string_loop
  mov eax, [STRING_DST]
  mov ebx, PHASE_STRING
  call store_phase_result
  ret

phase_branch:
  mov dword [BENCH_PHASE], PHASE_BRANCH
  mov ecx, BRANCH_ITER
  xor eax, eax
  mov ebx, 00000100h
phase_branch_loop:
  test al, 1
  jz near phase_branch_even
  sub ebx, eax
  jmp near phase_branch_after
phase_branch_even:
  add ebx, eax
phase_branch_after:
  call branch_helper
  dec ecx
  jnz phase_branch_loop
  mov eax, ebx
  mov ebx, PHASE_BRANCH
  call store_phase_result
  ret

branch_helper:
  inc eax
  cmp eax, 64
  jne near branch_helper_done
  xor eax, eax
branch_helper_done:
  ret

phase_generic:
  mov dword [BENCH_PHASE], PHASE_GENERIC
  mov ebp, GENERIC_ITER
  xor eax, eax
  xor ebx, ebx
  xor edx, edx
phase_generic_loop:
  db 0C6h, 0C0h, 012h
  db 0C6h, 0C3h, 034h
  db 0C6h, 0C2h, 056h
  db 0C6h, 0C4h, 078h
  dec ebp
  jnz phase_generic_loop
  xor eax, ebx
  xor eax, edx
  mov ebx, PHASE_GENERIC
  call store_phase_result
  ret

phase_syscall:
  mov dword [BENCH_PHASE], PHASE_SYSCALL
  mov ecx, SYSCALL_ITER
  xor edx, edx
phase_syscall_loop:
  mov eax, 26
  mov ebx, 9
  int 40h
  add edx, eax
  dec ecx
  jnz phase_syscall_loop
  mov eax, edx
  mov ebx, PHASE_SYSCALL
  call store_phase_result
  ret

store_phase_result:
  push ecx
  push edx
  mov edx, [BENCH_ROUND_PTR]
  imul edx, PHASE_COUNT
  add edx, ebx
  dec edx
  shl edx, 2
  mov [BENCH_RESULT_BASE + edx], eax
  add [BENCH_CHECKSUM], eax
  pop edx
  pop ecx
  ret

init_bench_state:
  mov dword [BENCH_MAGIC0], 4B534242h
  mov dword [BENCH_MAGIC1], 48433130h
  mov dword [BENCH_VERSION], 1
  mov dword [BENCH_PHASE], 0
  mov dword [BENCH_ROUND_PTR], 0FFFFFFFFh
  mov dword [BENCH_CHECKSUM], 0
  mov dword [BENCH_FLAGS], 0
  mov edi, BENCH_RESULT_BASE
  mov ecx, PHASE_COUNT * BENCH_ROUNDS
  xor eax, eax
init_bench_state_clear:
  mov [edi], eax
  add edi, 4
  dec ecx
  jnz init_bench_state_clear
  ret

init_buffers:
  mov edi, MEM32_SRC
  mov ecx, (MEM32_LIMIT - MEM32_SRC) / 4
  mov eax, 13579BDFh
init_mem32_src_loop:
  mov [edi], eax
  add eax, 09E3779B9h
  add edi, 4
  dec ecx
  jnz init_mem32_src_loop

  mov edi, MEM32_DST
  mov ecx, (MEM32_LIMIT - MEM32_DST) / 4
  xor eax, eax
init_mem32_dst_loop:
  mov [edi], eax
  add edi, 4
  dec ecx
  jnz init_mem32_dst_loop

  mov edi, BYTE_SRC
  mov ecx, BYTE_LIMIT - BYTE_SRC
  xor eax, eax
init_byte_src_loop:
  mov [edi], al
  inc al
  inc edi
  dec ecx
  jnz init_byte_src_loop

  mov edi, BYTE_DST
  mov ecx, BYTE_LIMIT - BYTE_DST
  xor eax, eax
init_byte_dst_loop:
  mov [edi], al
  inc edi
  dec ecx
  jnz init_byte_dst_loop

  mov edi, STRING_SRC
  mov ecx, (STRING_LIMIT - STRING_SRC) / 4
  mov eax, 0C001D00Dh
init_string_src_loop:
  mov [edi], eax
  add eax, 1020304h
  add edi, 4
  dec ecx
  jnz init_string_src_loop

  mov edi, STRING_DST
  mov ecx, (STRING_LIMIT - STRING_DST) / 4
  xor eax, eax
init_string_dst_loop:
  mov [edi], eax
  add edi, 4
  dec ecx
  jnz init_string_dst_loop

  mov edi, XLAT_TABLE
  mov ecx, 256
  xor eax, eax
init_xlat_loop:
  mov dl, al
  xor dl, 05Ah
  mov [edi], dl
  inc al
  inc edi
  dec ecx
  jnz init_xlat_loop
  ret

I_END:
