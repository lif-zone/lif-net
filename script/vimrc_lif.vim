fun CVSAnnotate()
  enew | r ! git annotate #
endfun

command! -nargs=0 CVSAnnotate call CVSAnnotate()

