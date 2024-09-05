const CONFIG = {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TOGETHER_AI_API_KEY: process.env.TOGETHER_AI_API_KEY,
}

if (!CONFIG.TAVILY_API_KEY || !CONFIG.ANTHROPIC_API_KEY || !CONFIG.TOGETHER_AI_API_KEY) {
    console.error('Please provide Tavily, Anthropic and Together API keys')
    process.exit(1)
}

import { ChatTogetherAI } from "@langchain/community/chat_models/togetherai";
import { Annotation, MemorySaver, MessagesAnnotation, NodeInterrupt, StateGraph } from "@langchain/langgraph";

const model = new ChatTogetherAI({
    model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    temperature: 0,
});




const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    refundAuthorized: Annotation<boolean>,
})


const initialSupport = async (state: typeof StateAnnotation.State) => {
    const SYSTEM_TEMPLATE =
        `You are frontline support staff for LangCorp, a company that sells computers.
  Be concise in your responses.
  You can chat with customers and help them with basic questions, but if the customer is having a billing or technical problem,
  do not try to answer the question directly or gather information.
  Instead, immediately transfer them to the billing or technical team by asking the user to hold for a moment.
  Otherwise, just respond conversationally.`;
    const modelResponse = model.invoke([
        { role: "system", content: SYSTEM_TEMPLATE },
        ...state.messages,
    ]);
    // Will append the response message to the current interaction state
    return { messages: modelResponse };
};

const billingSupport = async (state: typeof StateAnnotation.State) => {
    const SYSTEM_TEMPLATE =
        `You are an expert billing support specialist for LangCorp, a company that sells computers.
  Help the user to the best of your ability, but be concise in your responses.
  You have the ability to authorize refunds, which you can do by transferring the user to another agent who will collect the required information.
  If you do, assume the other agent has all necessary information about the customer and their order.
  You do not need to ask the user for more information.
  
  Help the user to the best of your ability, but be concise in your responses.`;

    let trimmedHistory = state.messages;
    // Make the user's question the most recent message in the history.
    // This helps small models stay focused.
    if (trimmedHistory.at(-1)?._getType() === "ai") {
        trimmedHistory = trimmedHistory.slice(0, -1);
    }

    const response = await model.invoke([
        {
            role: "system",
            content: SYSTEM_TEMPLATE,
        },
        ...trimmedHistory,
    ]);
    return {
        messages: response,
    };
};

const technicalSupport = async (state: typeof StateAnnotation.State) => {
    const SYSTEM_TEMPLATE =
        `You are an expert at diagnosing technical computer issues. You work for a company called LangCorp that sells computers.
  Help the user to the best of your ability, but be concise in your responses.`;

    let trimmedHistory = state.messages;
    // Make the user's question the most recent message in the history.
    // This helps small models stay focused.
    if (trimmedHistory.at(-1)?._getType() === "ai") {
        trimmedHistory = trimmedHistory.slice(0, -1);
    }

    const response = await model.invoke([
        {
            role: "system",
            content: SYSTEM_TEMPLATE,
        },
        ...trimmedHistory,
    ]);

    return {
        messages: response,
    };
};


const handleRefund = async (state: typeof StateAnnotation.State) => {
    if (!state.refundAuthorized) {
        console.log("--- HUMAN AUTHORIZATION REQUIRED FOR REFUND ---");
        throw new NodeInterrupt("Human authorization required.")
    }
    return {
        messages: {
            role: "assistant",
            content: "Refund processed!",
        },
    };
};


let builder = new StateGraph(StateAnnotation)
    .addNode("initial_support", initialSupport)
    .addNode("billing_support", billingSupport)
    .addNode("technical_support", technicalSupport)
    .addNode("handle_refund", handleRefund)
    .addEdge("__start__", "initial_support");



builder = builder.addConditionalEdges("initial_support", async (state: typeof StateAnnotation.State) => {
    const SYSTEM_TEMPLATE = `You are an expert customer support routing system.
  Your job is to detect whether a customer support representative is routing a user to a billing team or a technical team, or if they are just responding conversationally.`;
    const HUMAN_TEMPLATE =
        `The previous conversation is an interaction between a customer support representative and a user.
  Extract whether the representative is routing the user to a billing or technical team, or whether they are just responding conversationally.
  
  If they want to route the user to the billing team, respond only with the word "BILLING".
  If they want to route the user to the technical team, respond only with the word "TECHNICAL".
  Otherwise, respond only with the word "RESPOND".
  
  Remember, only respond with one of the above words.`;
    const rawCategorizationOutput = await model.invoke([{
        role: "system",
        content: SYSTEM_TEMPLATE,
    },
    ...state.messages,
    {
        role: "user",
        content: HUMAN_TEMPLATE,
    }]);
    // Message output can be content blocks for some providers, but not Together
    const rawCategorization = rawCategorizationOutput.content as string;
    if (rawCategorization.includes("BILLING")) {
        return "billing";
    } else if (rawCategorization.includes("TECHNICAL")) {
        return "technical";
    } else {
        return "conversational";
    }
}, {
    billing: "billing_support",
    technical: "technical_support",
    conversational: "__end__",
});

console.log("Added edges!");



builder = builder
    .addEdge("technical_support", "__end__")
    .addConditionalEdges("billing_support", async (state) => {
        const mostRecentMessage = state.messages.at(-1);
        const SYSTEM_TEMPLATE =
            `Your job is to detect whether a billing support representative wants to refund the user.`;
        const HUMAN_TEMPLATE =
            `The following text is a response from a customer support representative.
  Extract whether they want to refund the user or not.
  If they want to refund the user, respond only with the word "REFUND".
  Otherwise, respond only with the word "RESPOND".

  Here is the text:

  
  ${mostRecentMessage?.content}
  

  Remember, only respond with one word.`;
        const rawResponse = await model.invoke([
            {
                role: "system",
                content: SYSTEM_TEMPLATE,
            },
            {
                role: "user",
                content: HUMAN_TEMPLATE,
            }
        ]);
        const response = rawResponse.content as string;
        if (response.includes("REFUND")) {
            return "refund";
        } else {
            return "__end__";
        }
    }, {
        refund: "handle_refund",
        __end__: "__end__",
    })
    .addEdge("handle_refund", "__end__");

console.log("Added edges!");


const checkpointer = new MemorySaver();

const graph = builder.compile({
    checkpointer,
});


const main = async () => {
    const stream = await graph.stream({
        messages: [
            {
                role: "user",
                content: "I've changed my mind and I want a refund for order #182818!",
            }
        ]
    }, {
        configurable: {
            thread_id: "refund_testing_id",
        }
    });

    for await (const value of stream) {
        console.log("---STEP---");
        console.log(value);
        console.log("---END STEP---");
    }
}

main();