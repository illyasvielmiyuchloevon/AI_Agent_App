import json
from typing import List, Optional, AsyncGenerator, Any
from anthropic import AsyncAnthropic
from ..llm_client import LLMClient
from ..messages import UnifiedMessage, ToolCall
from ..base_tool import BaseTool
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

class AnthropicProvider(LLMClient):
    def __init__(self, api_key: str, model: str = "claude-3-opus-20240229", base_url: Optional[str] = None):
        self.client = AsyncAnthropic(api_key=api_key, base_url=base_url)
        self.model = model

    def _prepare_messages(self, messages: List[UnifiedMessage]):
        system_message = None
        anthropic_messages = []
        
        for msg in messages:
            if msg.role == "system":
                # Use the last system message found, or concatenate them. 
                # Here we simplify by taking the content of system messages.
                if system_message is None:
                    system_message = msg.content
                else:
                    system_message += f"\n{msg.content}"
            else:
                anthropic_messages.append(msg.to_anthropic())
                
        return system_message, anthropic_messages

    async def chat_completion(
        self, 
        messages: List[UnifiedMessage], 
        tools: Optional[List[BaseTool]] = None,
        session_id: Optional[str] = None,
        **kwargs
    ) -> UnifiedMessage:
        system, anthropic_messages = self._prepare_messages(messages)
        anthropic_tools = [tool.to_anthropic_schema() for tool in tools] if tools else None

        model = kwargs.pop('model', self.model)
        params = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": 4096, # Default max tokens
        }
        
        if system:
            params["system"] = system
            
        if anthropic_tools:
            params["tools"] = anthropic_tools

        params.update(kwargs)

        req_body = params
        success = False
        parsed_success = None
        parse_error = None
        res_body = None
        status_code = 0

        try:
            response = await self.client.messages.create(**params)
            
            success = True
            status_code = 200
            res_body = response.model_dump()

            try:
                content = ""
                tool_calls = []
                
                for block in response.content:
                    if block.type == "text":
                        content += block.text
                    elif block.type == "tool_use":
                        tool_calls.append(ToolCall(
                            id=block.id,
                            function={
                                "name": block.name,
                                "arguments": block.input
                            }
                        ))
                
                parsed_success = True
                return UnifiedMessage(
                    role="assistant",
                    content=content if content else None,
                    tool_calls=tool_calls if tool_calls else None
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
                        provider="anthropic",
                        method="messages.create",
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
        system, anthropic_messages = self._prepare_messages(messages)
        anthropic_tools = [tool.to_anthropic_schema() for tool in tools] if tools else None

        params = {
            "model": self.model,
            "messages": anthropic_messages,
            "max_tokens": 4096,
            "stream": True,
        }
        
        if system:
            params["system"] = system
            
        if anthropic_tools:
            params["tools"] = anthropic_tools
            
        params.update(kwargs)

        stream = await self.client.messages.create(**params)

        async for chunk in stream:
            yield chunk
