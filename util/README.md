LIF - Util
==========

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
  mocha -g etask --inspect-brk```
- Open Chrome browser
- Browse to chrome://inspect
- Click 'Open dedicated DevTools for Node'

## How to submit a fix
- Clone lif-zone/server.git
- Commit all your changes
- Email xxderry@gmail.com

## Questions
xxderry@gmail.com

## ESlint
- All files ```eslint .```
- Specific files ```eslint test.js```
