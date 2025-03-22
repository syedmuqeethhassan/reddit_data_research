import snoowrap from 'snoowrap';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Reddit API client
const reddit = new snoowrap({
    userAgent: process.env.USER_AGENT,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});

// Function to fetch Reddit posts
export async function fetchHotPosts(subreddit) {
    try {
        const posts = await reddit.getHot(subreddit, { limit: 5 });
        return posts.map(post => ({ title: post.title, url: post.url }));
    } catch (error) {
        console.error(`Error fetching posts from r/${subreddit}:`, error);
        return [];
    }
}

/**
 * Search within a specific subreddit for posts matching a keyword
 * @param {string} keyword - The search keyword
 * @param {string} subreddit - The subreddit to search in (without the "r/")
 * @param {number} maxResults - Maximum number of results to return
 * @param {string} sortBy - How to sort results: "relevance", "new", "hot", "top", "comments"
 * @return {Promise<Array>} Array of post objects
 */
export async function searchSubreddit(keyword, subreddit = "whatcarshouldibuy", maxResults = 2, sortBy = "relevance") {
    try {
        const searchResults = await reddit.search({
            query: keyword,
            subreddit: subreddit,
            limit: maxResults,
            sort: sortBy,
        });

        return searchResults.map(post => ({
            id: post.id,
            title: post.title,
            url: post.url,
            selftext: post.selftext || "[No content]",
            subreddit: post.subreddit_name_prefixed,
            created: new Date(post.created_utc * 1000).toISOString(),
            score: post.score,
            author: post.author ? post.author.name : "[deleted]",
            num_comments: post.num_comments
        }));
    } catch (error) {
        console.error(`Error searching r/${subreddit} for "${keyword}":`, error);
        return [];
    }
}

/**
 * Search all of Reddit for a specific keyword (keeping for backward compatibility)
 */
export async function searchReddit(keyword, maxResults = 2) {
    console.warn("Warning: searchReddit is searching across all subreddits. Consider using searchSubreddit instead.");
    try {
        const searchResults = await reddit.search({
            query: keyword,
            limit: maxResults,
            sort: "relevance",
        });

        return searchResults.map(post => ({
            id: post.id,
            title: post.title,
            url: post.url,
            selftext: post.selftext || "[No content]",
            subreddit: post.subreddit_name_prefixed,
        }));
    } catch (error) {
        console.error(`Error searching Reddit for "${keyword}":`, error);
        return [];
    }
}

/**
 * Fetch all comments and their replies for a given post
 * @param {string} postId - The Reddit post ID
 * @param {number} maxComments - Maximum number of top-level comments to fetch
 * @param {number} maxDepth - Maximum depth for nested replies
 * @return {Promise<Array>} Array of comment objects with nested replies
 */
export async function fetchPostComments(postId, maxComments = 25, maxDepth = 3) {
  if (!postId) {
    console.error("Error: postId is undefined or empty");
    return [];
  }

  try {
    // Get the submission
    const submission = await reddit.getSubmission(postId).fetch();
    
    // Fetch comments with expanded replies
    const comments = await submission.comments.fetchAll({ limit: maxComments });
    
    // Process each comment with metadata and replies in parallel
    const processedComments = await Promise.all(
      comments.map(comment => processComment(comment, maxDepth, 1))
    );
    
    // Filter out null comments (deleted/removed)
    return processedComments.filter(comment => comment !== null);
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error);
    return [];
  }
}

/**
 * Process a comment and its replies recursively
 * @param {Object} comment - The comment object from snoowrap
 * @param {number} maxDepth - Maximum depth to traverse
 * @param {number} currentDepth - Current depth in the comment tree
 * @return {Promise<Object>} Processed comment with metadata and replies
 */
async function processComment(comment, maxDepth, currentDepth) {
  // Skip deleted/removed comments
  if (!comment || comment.body === "[deleted]" || comment.body === "[removed]") {
    return null;
  }

  // Create the base comment object with metadata
  const processedComment = {
    id: comment.id,
    author: comment.author ? comment.author.name : "[deleted]",
    text: comment.body,
    score: comment.score,
    created: new Date(comment.created_utc * 1000).toISOString(),
    permalink: `https://reddit.com${comment.permalink}`,
    replies: []
  };

  // Stop recursion if we've reached max depth
  if (currentDepth >= maxDepth) {
    // Indicate there might be more replies
    const replyCount = comment.replies ? comment.replies.length : 0;
    if (replyCount > 0) {
      processedComment.moreReplies = replyCount;
    }
    return processedComment;
  }

  // Process replies if they exist
  if (comment.replies && comment.replies.length > 0) {
    // Fetch and expand the replies
    const replies = await comment.replies.fetchAll();
    
    // Process each reply recursively in parallel
    const processedReplies = await Promise.all(
      replies.map(reply => processComment(reply, maxDepth, currentDepth + 1))
    );
    
    // Filter out null values (deleted comments)
    processedComment.replies = processedReplies.filter(reply => reply !== null);
  }

  return processedComment;
}

/**
 * Fetch comments for multiple posts in batch
 * @param {Array<string>} postIds - Array of Reddit post IDs
 * @param {number} maxComments - Maximum comments per post
 * @param {number} maxDepth - Maximum reply depth
 * @return {Promise<Object>} Object mapping post IDs to their comments
 */
export async function fetchCommentsForMultiplePosts(postIds, maxComments = 15, maxDepth = 2) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    console.error("Error: No valid post IDs provided");
    return {};
  }

  const results = {};
  
  // Process posts in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < postIds.length; i += batchSize) {
    const batch = postIds.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (postId) => {
        const comments = await fetchPostComments(postId, maxComments, maxDepth);
        return { postId, comments };
      })
    );
    
    // Add batch results to the overall results
    batchResults.forEach(({ postId, comments }) => {
      results[postId] = comments;
    });
    
    // Add a small delay between batches to avoid rate limiting
    if (i + batchSize < postIds.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return results;
}

/**
 * Fetch hot posts from multiple subreddits in parallel
 * @param {Array<string>} subreddits - Array of subreddit names
 * @param {number} limit - Maximum posts per subreddit
 * @return {Promise<Object>} Object mapping subreddit names to their posts
 */
export async function fetchHotPostsFromMultipleSubreddits(subreddits, limit = 5) {
  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    console.error("Error: No valid subreddits provided");
    return {};
  }

  try {
    // Fetch posts from all subreddits in parallel
    const results = await Promise.all(
      subreddits.map(async (subreddit) => {
        const posts = await reddit.getHot(subreddit, { limit });
        const formattedPosts = posts.map(post => ({ 
          id: post.id,
          title: post.title, 
          url: post.url,
          score: post.score,
          created: new Date(post.created_utc * 1000).toISOString(),
          author: post.author ? post.author.name : "[deleted]",
          num_comments: post.num_comments
        }));
        return { subreddit, posts: formattedPosts };
      })
    );

    // Convert results array to object with subreddit names as keys
    const resultsObject = {};
    results.forEach(({ subreddit, posts }) => {
      resultsObject[subreddit] = posts;
    });

    return resultsObject;
  } catch (error) {
    console.error(`Error fetching posts from multiple subreddits:`, error);
    return {};
  }
}

/**
 * Search multiple subreddits for posts matching a keyword in parallel
 * @param {string} keyword - The search keyword
 * @param {Array<string>} subreddits - Array of subreddit names
 * @param {number} maxResults - Maximum results per subreddit
 * @param {string} sortBy - How to sort results
 * @return {Promise<Object>} Object mapping subreddit names to their search results
 */
export async function searchMultipleSubreddits(keyword, subreddits, maxResults = 2, sortBy = "relevance") {
  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    console.error("Error: No valid subreddits provided");
    return {};
  }

  try {
    // Search all subreddits in parallel
    const results = await Promise.all(
      subreddits.map(async (subreddit) => {
        const searchResults = await searchSubreddit(keyword, subreddit, maxResults, sortBy);
        return { subreddit, results: searchResults };
      })
    );

    // Convert results array to object with subreddit names as keys
    const resultsObject = {};
    results.forEach(({ subreddit, results }) => {
      resultsObject[subreddit] = results;
    });

    return resultsObject;
  } catch (error) {
    console.error(`Error searching multiple subreddits for "${keyword}":`, error);
    return {};
  }
}

// For backwards compatibility
export async function fetchAllCommentsAndReplies(postId, maxTopLevel = 10, maxRepliesPerComment = 10) {
    console.warn("Warning: fetchAllCommentsAndReplies is deprecated. Consider using fetchPostComments instead.");
    return fetchPostComments(postId, maxTopLevel, 2);
}

// For backwards compatibility
export async function fetchRepliesRecursively(comment, maxReplies) {
    console.warn("Warning: fetchRepliesRecursively is deprecated. This is now handled internally by fetchPostComments.");
    if (!comment.replies || comment.replies.length === 0) return [];

    let replies = await comment.replies.fetch({ limit: maxReplies });

    // Process replies in parallel
    const nestedReplies = await Promise.all(
        replies.map(async reply => {
            const subReplies = await fetchRepliesRecursively(reply, maxReplies);

            return {
                text: reply.body,
                url: `https://reddit.com${reply.permalink}`,
                replies: subReplies
            };
        })
    );

    return nestedReplies;
}



// import snoowrap from 'snoowrap';
// import dotenv from 'dotenv';

// // Load environment variables
// dotenv.config();

// // Initialize Reddit API client
// const reddit = new snoowrap({
//     userAgent: process.env.USER_AGENT,
//     clientId: process.env.CLIENT_ID,
//     clientSecret: process.env.CLIENT_SECRET,
//     username: process.env.REDDIT_USERNAME,
//     password: process.env.REDDIT_PASSWORD,
// });

// // Function to fetch Reddit posts
// export async function fetchHotPosts(subreddit) {
//     try {
//         const posts = await reddit.getHot(subreddit, { limit: 5 });
//         return posts.map(post => ({ title: post.title, url: post.url }));
//     } catch (error) {
//         console.error(`Error fetching posts from r/${subreddit}:`, error);
//         return [];
//     }
// }

// /**
//  * Search within a specific subreddit for posts matching a keyword
//  * @param {string} keyword - The search keyword
//  * @param {string} subreddit - The subreddit to search in (without the "r/")
//  * @param {number} maxResults - Maximum number of results to return
//  * @param {string} sortBy - How to sort results: "relevance", "new", "hot", "top", "comments"
//  * @return {Promise<Array>} Array of post objects
//  */
// export async function searchSubreddit(keyword, subreddit = "whatcarshouldibuy", maxResults = 2, sortBy = "relevance") {
//     try {
//         const searchResults = await reddit.search({
//             query: keyword,
//             subreddit: subreddit,
//             limit: maxResults,
//             sort: sortBy,
//         });

//         return searchResults.map(post => ({
//             id: post.id,
//             title: post.title,
//             url: post.url,
//             selftext: post.selftext || "[No content]",
//             subreddit: post.subreddit_name_prefixed,
//             created: new Date(post.created_utc * 1000).toISOString(),
//             score: post.score,
//             author: post.author ? post.author.name : "[deleted]",
//             num_comments: post.num_comments
//         }));
//     } catch (error) {
//         console.error(`Error searching r/${subreddit} for "${keyword}":`, error);
//         return [];
//     }
// }

// /**
//  * Search all of Reddit for a specific keyword (keeping for backward compatibility)
//  */
// export async function searchReddit(keyword, maxResults = 2) {
//     console.warn("Warning: searchReddit is searching across all subreddits. Consider using searchSubreddit instead.");
//     try {
//         const searchResults = await reddit.search({
//             query: keyword,
//             limit: maxResults,
//             sort: "relevance",
//         });

//         return searchResults.map(post => ({
//             id: post.id,
//             title: post.title,
//             url: post.url,
//             selftext: post.selftext || "[No content]",
//             subreddit: post.subreddit_name_prefixed,
//         }));
//     } catch (error) {
//         console.error(`Error searching Reddit for "${keyword}":`, error);
//         return [];
//     }
// }

// /**
//  * Fetch all comments and their replies for a given post
//  * @param {string} postId - The Reddit post ID
//  * @param {number} maxComments - Maximum number of top-level comments to fetch
//  * @param {number} maxDepth - Maximum depth for nested replies
//  * @return {Promise<Array>} Array of comment objects with nested replies
//  */
// export async function fetchPostComments(postId, maxComments = 25, maxDepth = 3) {
//   if (!postId) {
//     console.error("Error: postId is undefined or empty");
//     return [];
//   }

//   try {
//     // Get the submission
//     const submission = await reddit.getSubmission(postId).fetch();
    
//     // Fetch comments with expanded replies
//     const comments = await submission.comments.fetchAll({ limit: maxComments });
    
//     // Process each comment with metadata and replies
//     const processedComments = await Promise.all(
//       comments.map(comment => processComment(comment, maxDepth, 1))
//     );
    
//     // Filter out null comments (deleted/removed)
//     return processedComments.filter(comment => comment !== null);
//   } catch (error) {
//     console.error(`Error fetching comments for post ${postId}:`, error);
//     return [];
//   }
// }

// /**
//  * Process a comment and its replies recursively
//  * @param {Object} comment - The comment object from snoowrap
//  * @param {number} maxDepth - Maximum depth to traverse
//  * @param {number} currentDepth - Current depth in the comment tree
//  * @return {Promise<Object>} Processed comment with metadata and replies
//  */
// async function processComment(comment, maxDepth, currentDepth) {
//   // Skip deleted/removed comments
//   if (!comment || comment.body === "[deleted]" || comment.body === "[removed]") {
//     return null;
//   }

//   // Create the base comment object with metadata
//   const processedComment = {
//     id: comment.id,
//     author: comment.author ? comment.author.name : "[deleted]",
//     text: comment.body,
//     score: comment.score,
//     created: new Date(comment.created_utc * 1000).toISOString(),
//     permalink: `https://reddit.com${comment.permalink}`,
//     replies: []
//   };

//   // Stop recursion if we've reached max depth
//   if (currentDepth >= maxDepth) {
//     // Indicate there might be more replies
//     const replyCount = comment.replies ? comment.replies.length : 0;
//     if (replyCount > 0) {
//       processedComment.moreReplies = replyCount;
//     }
//     return processedComment;
//   }

//   // Process replies if they exist
//   if (comment.replies && comment.replies.length > 0) {
//     // Fetch and expand the replies
//     const replies = await comment.replies.fetchAll();
    
//     // Process each reply recursively
//     const processedReplies = await Promise.all(
//       replies.map(reply => processComment(reply, maxDepth, currentDepth + 1))
//     );
    
//     // Filter out null values (deleted comments)
//     processedComment.replies = processedReplies.filter(reply => reply !== null);
//   }

//   return processedComment;
// }

// /**
//  * Fetch comments for multiple posts in batch
//  * @param {Array<string>} postIds - Array of Reddit post IDs
//  * @param {number} maxComments - Maximum comments per post
//  * @param {number} maxDepth - Maximum reply depth
//  * @return {Promise<Object>} Object mapping post IDs to their comments
//  */
// export async function fetchCommentsForMultiplePosts(postIds, maxComments = 15, maxDepth = 2) {
//   if (!Array.isArray(postIds) || postIds.length === 0) {
//     console.error("Error: No valid post IDs provided");
//     return {};
//   }

//   const results = {};
  
//   // Process posts in batches to avoid rate limiting
//   const batchSize = 5;
//   for (let i = 0; i < postIds.length; i += batchSize) {
//     const batch = postIds.slice(i, i + batchSize);
    
//     // Process batch in parallel
//     const batchResults = await Promise.all(
//       batch.map(async (postId) => {
//         const comments = await fetchPostComments(postId, maxComments, maxDepth);
//         return { postId, comments };
//       })
//     );
    
//     // Add batch results to the overall results
//     batchResults.forEach(({ postId, comments }) => {
//       results[postId] = comments;
//     });
    
//     // Add a small delay between batches to avoid rate limiting
//     if (i + batchSize < postIds.length) {
//       await new Promise(resolve => setTimeout(resolve, 5));
//     }
//   }
  
//   return results;
// }

// // For backwards compatibility
// export async function fetchAllCommentsAndReplies(postId, maxTopLevel = 10, maxRepliesPerComment = 10) {
//     console.warn("Warning: fetchAllCommentsAndReplies is deprecated. Consider using fetchPostComments instead.");
//     return fetchPostComments(postId, maxTopLevel, 2);
// }

// // For backwards compatibility
// // export async function fetchRepliesRecursively(comment, maxReplies) {
// //     console.warn("Warning: fetchRepliesRecursively is deprecated. This is now handled internally by fetchPostComments.");
// //     if (!comment.replies || comment.replies.length === 0) return [];

// //     let replies = await comment.replies.fetch({ limit: maxReplies });

// //     const nestedReplies = await Promise.all(
// //         replies.map(async reply => {
// //             const subReplies = await fetchRepliesRecursively(reply, maxReplies);

// //             return {
// //                 text: reply.body,
// //                 url: `https://reddit.com${reply.permalink}`,
// //                 replies: subReplies
// //             };
// //         })
// //     );

// //     return nestedReplies;
// // }