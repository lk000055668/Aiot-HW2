from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from .data import MAX_BYTES

class BodyLimitMiddleware:
    """Bound total multipart traffic before Starlette spools an upload to disk."""
    def __init__(self,app): self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        maximum=MAX_BYTES+1024*1024
        headers=dict(scope.get('headers',[]))
        try:declared=int(headers.get(b'content-length',b'0'))
        except ValueError:declared=maximum+1
        if declared>maximum:
            return await JSONResponse({'detail':'Request body exceeds the upload size limit.'},status_code=413)(scope,receive,send)
        count=0
        async def bounded_receive():
            nonlocal count
            message=await receive()
            count+=len(message.get('body',b''))
            if count>maximum:raise HTTPException(413,'Request body exceeds the upload size limit.')
            return message
        await self.app(scope,bounded_receive,send)
