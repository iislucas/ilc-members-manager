import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

/*
Assume setup in root README.md file...

To deploy: 

(from root directory, not functions subdirectory)
```sh
pnpm deploy:functions
```

To emulate locally, run: 

(from the functions subdirectory)
```sh
pnpm run emulate
```

Wait a bit for it to show a list of available ports etc and listing of URLs
for different functions. Then... 

```sh
cd functions
pnpm run emulate
```
And in another shell... 
```sh
curl http://127.0.0.1:5001/ilc-paris-class-tracker/us-central1/httpLogger -H "Content-Type: application/json" -d '{ "foo": "bar"}'
```

Live-reload works reasonably well. Edit the functions file and rerun.
*/

export const httpLogger = onRequest((request, response) => {
  logger.info('HTTP Logger received a request', {
    headers: request.headers,
    body: request.body,
    query: request.query,
  });
  response.send(
    `Request logged successfully, with:
request.body: 
'''
${JSON.stringify(request.body)}
'''

request.query: 
'''
${JSON.stringify(request.query)}
'''

request.headers:
'''
${JSON.stringify(request.headers)}
'''
`
  );
});
