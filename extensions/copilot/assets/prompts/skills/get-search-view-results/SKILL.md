---
name: get-search-view-results
description: 'Get the current search results from the Search view in Si Code'
---

# Getting Search View Results

1. Si Code has a search view, and it can have existing search results.
2. To get the current search results, you can use the Si Code command `search.action.getSearchResults`.
3. Run that command via the `copilot_runVscodeCommand` tool. Make sure to pass the `skipCheck` argument as true to avoid checking if the command exists, as we know it does.