LIF - Util
==========

## LIF Task/Bugs
- Fix etask.js bug [wait_in_generator](https://github.com/lif-zone/server/blob/main/util/test.js#L4054).
  The bug is due to etask generator not handling correctly 'light-weight' ``this.wait()`` object.
  The fix required is around 10-20 lines of code in ```etask.js```, probably
  ```in _run()``` and ```_handle_rv()```, and ```maybe _next()```.

## Installation

```
git clone https://github.com/lif-zone/server.git lif_server
cd lif_server
npm install
```

## Node Development
```# cd lif_server
cd util

# run all tests in node (mocha)
mocha

# run specific tests
mocha -g etask
```

## Debugging
- Run mocha with ```--inspect-brk```
  ```
  # cd lif_server/util
  mocha -g etask --inspect-brk
  ```
- Open Chrome browser
- Browse to chrome://inspect
- Click 'Open dedicated DevTools for Node'

## ESlint
- All files
  ```eslint .```
- Specific files
  ```eslint test.js```
