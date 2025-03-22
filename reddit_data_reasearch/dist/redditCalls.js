"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHotPosts = fetchHotPosts;
const snoowrap_1 = __importDefault(require("snoowrap"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
// Initialize Reddit API client
const reddit = new snoowrap_1.default({
    userAgent: process.env.USER_AGENT,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});
// Function to fetch Reddit posts
function fetchHotPosts(subreddit) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const posts = yield reddit.getHot(subreddit, { limit: 5 });
            return posts.map(post => ({ title: post.title, url: post.url }));
        }
        catch (error) {
            console.error(`Error fetching posts from r/${subreddit}:`, error);
            return [];
        }
    });
}
