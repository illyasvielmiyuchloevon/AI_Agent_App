import json
from typing import List, Optional, AsyncGenerator, Any
from openai import AsyncOpenAI
from ..llm_client import LLMClient
from ..messages import UnifiedMessage, ToolCall
from ..base_tool import BaseTool
# Attempt to import database for logging. 
# Using absolute import assuming 'backend' is in path, or relative.
# Since we run as 'python -m backend.main' or inside backend dir.
try:
    from ... import database
except ImportError:
    import sys
    import os
    
    # Add backend directory to path to allow direct import
    current_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.abspath(os.path.join(current_dir, "../.."))
    
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
        
    try:
        import database
    except ImportError:
        # Define a dummy database to prevent NameError if import still fails
        class DummyDatabase:
            def add_log(self, *args, **kwargs):
                print("Warning: Database logging disabled due to import error.")
        database = DummyDatabase()

class OpenAIProvider(LLMClient):
    def __init__(self, api_key: str, model: str = "gpt-4-turbo", base_url: Optional[str] = None):
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self.model = model

    async def chat_completion(
        self, 
        messages: List[UnifiedMessage], 
        tools: Optional[List[BaseTool]] = None,
        session_id: Optional[str] = None,
        **kwargs
    ) -> UnifiedMessage:
        openai_messages = [msg.to_openai() for msg in messages]
        openai_tools = [tool.to_openai_schema() for tool in tools] if tools else None

        model = kwargs.pop('model', self.model)
        
        # Prepare log data
        req_body = {
            "model": model,
            "messages": openai_messages,
            "tools": openai_tools,
            "kwargs": kwargs
        }
        
        success = False
        parsed_success = None
        parse_error = None
        res_body = None
        status_code = 0

        try:
            response = await self.client.chat.completions.create(
                model=model,
                messages=openai_messages,
                tools=openai_tools,
                **kwargs
            )
            
            # Log successful response
            success = True
            status_code = 200
            res_body = response.model_dump()

            try:
                choice = response.choices[0]
                message = choice.message
                
                tool_calls = None
                if message.tool_calls:
                    tool_calls = []
                    for tc in message.tool_calls:
                        tool_calls.append(ToolCall(
                            id=tc.id,
                            function={
                                "name": tc.function.name,
                                "arguments": json.loads(tc.function.arguments)
                            }
                        ))

                parsed_success = True
                return UnifiedMessage(
                    role="assistant",
                    content=message.content,
                    tool_calls=tool_calls
                )
            except Exception as parse_exc:
                parsed_success = False
                parse_error = str(parse_exc)
                return UnifiedMessage(
                    role="assistant",
                    content=f"Failed to parse model response: {parse_exc}"
                )
        except Exception as e:
            success = False
            status_code = 500
            res_body = {"error": str(e)}
            parsed_success = False if parsed_success is None else parsed_success
            parse_error = parse_error or str(e)
            raise e
        finally:
            if session_id:
                try:
                    database.add_log(
                        session_id=session_id,
                        provider="openai",
                        method="chat.completions.create",
                        url=str(self.client.base_url),
                        request_body=req_body,
                        response_body=res_body,
                        status_code=status_code,
                        success=success,
                        parsed_success=parsed_success,
                        parse_error=parse_error
                    )
                except Exception as log_err:
                    print(f"Failed to log API call: {log_err}")

    async def stream_chat_completion(
        self, 
        messages: List[UnifiedMessage], 
        tools: Optional[List[BaseTool]] = None,
        **kwargs
    ) -> AsyncGenerator[Any, None]:
        openai_messages = [msg.to_openai() for msg in messages]
        openai_tools = [tool.to_openai_schema() for tool in tools] if tools else None

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=openai_messages,
            tools=openai_tools,
            stream=True,
            **kwargs
        )

        async for chunk in stream:
            yield chunk
