// Set up the tool
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { StateGraph, Annotation, START, END, messagesStateReducer } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseMessage, AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

const GraphMessagesAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: messagesStateReducer,
  }),
});

const search = tool((_) => {
  return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
}, {
  name: "search",
  description: "Call to surf the web.",
  schema: z.string(),
})

const tools = [search]
const toolNode = new ToolNode(tools)

// Set up the model
const model = new ChatAnthropic({ model: "claude-3-5-sonnet-20240620" })

const askHumanTool = tool((_) => {
  return "The human said XYZ";
}, {
  name: "askHuman",
  description: "Ask the human for input.",
  schema: z.string(),
});


const modelWithTools = model.bindTools([...tools, askHumanTool])

// Define nodes and conditional edges

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof GraphMessagesAnnotation.State): "action" | "askHuman" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];
  const castLastMessage = lastMessage as AIMessage;
  // If there is no function call, then we finish
  if (castLastMessage && !castLastMessage.tool_calls?.length) {
    return END;
  }
  // If tool call is askHuman, we return that node
  // You could also add logic here to let some system know that there's something that requires Human input
  // For example, send a slack message, etc
  if (castLastMessage.tool_calls?.[0]?.name === "askHuman") {
    console.log("--- ASKING HUMAN ---")
    return "askHuman";
  }
  // Otherwise if it isn't, we continue with the action node
  return "action";
}


// Define the function that calls the model
async function callModel(state: typeof GraphMessagesAnnotation.State): Promise<{ messages: BaseMessage[] }> {
  const messages = state.messages;
  const response = await modelWithTools.invoke(messages);
  // We return an object with a messages property, because this will get added to the existing list
  return { messages: [response] };
}


// We define a fake node to ask the human
function askHuman(state: typeof GraphMessagesAnnotation.State): Partial<typeof GraphMessagesAnnotation.State> {
  return state;
}

// Define a new graph
const messagesWorkflow = new StateGraph(GraphMessagesAnnotation)
  // Define the two nodes we will cycle between
  .addNode("agent", callModel)
  .addNode("action", toolNode)
  .addNode("askHuman", askHuman)
  // We now add a conditional edge
  .addConditionalEdges(
    // First, we define the start node. We use `agent`.
    // This means these are the edges taken after the `agent` node is called.
    "agent",
    // Next, we pass in the function that will determine which node is called next.
    shouldContinue
  )
  // We now add a normal edge from `action` to `agent`.
  // This means that after `action` is called, `agent` node is called next.
  .addEdge("action", "agent")
  // After we get back the human response, we go back to the agent
  .addEdge("askHuman", "agent")
  // Set the entrypoint as `agent`
  // This means that this node is the first one called
  .addEdge(START, "agent");


// Setup memory
const messagesMemory = new MemorySaver();

// Finally, we compile it!
// This compiles it into a LangChain Runnable,
// meaning you can use it as you would any other runnable
const messagesApp = messagesWorkflow.compile({
    checkpointer: messagesMemory,
    interruptBefore: ["askHuman"]
});



const main = async () => {
// Input
const inputs = new HumanMessage("Use the search tool to ask the user where they are, then look up the weather there");

// Thread
const config2 = { configurable: { thread_id: "3" }, streamMode: "values" as const };

for await (const event of await messagesApp.stream({
  messages: [inputs]
}, config2)) {
  const recentMsg = event.messages[event.messages.length - 1];
  console.log(`================================ ${recentMsg._getType()} Message (1) =================================`)
  console.log(recentMsg.content);
}

console.log("next: ", (await messagesApp.getState(config2)).next)




const currentState = await messagesApp.getState(config2);
const toolCallId = currentState.values.messages[currentState.values.messages.length - 1].tool_calls[0].id;

// We now create the tool call with the id and the response we want
const toolMessage = new ToolMessage({
  tool_call_id: toolCallId,
  content: "san francisco"
});

console.log("next before update state: ", (await messagesApp.getState(config2)).next)

// We now update the state
// Notice that we are also specifying `asNode: "askHuman"`
// This will apply this update as this node,
// which will make it so that afterwards it continues as normal
await messagesApp.updateState(config2, { messages: [toolMessage] }, "askHuman");

// We can check the state
// We can see that the state currently has the `agent` node next
// This is based on how we define our graph,
// where after the `askHuman` node goes (which we just triggered)
// there is an edge to the `agent` node
console.log("next AFTER update state: ", (await messagesApp.getState(config2)).next)
// await messagesApp.getState(config)


// We can now tell the agent to continue. We can just pass in None as the input to the graph, since no additional input is needed
for await (const event of await messagesApp.stream(null, config2)) {
  console.log(event)
  const recentMsg = event.messages[event.messages.length - 1];
  console.log(`================================ ${recentMsg._getType()} Message (1) =================================`)
  if (recentMsg._getType() === "tool") {
    console.log({
      name: recentMsg.name,
      content: recentMsg.content
    })
  } else if (recentMsg._getType() === "ai") {
    console.log(recentMsg.content)
  }
}


}

main();