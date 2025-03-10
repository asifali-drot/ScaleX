import React from 'react'
import './NewsLetter.css'

export const NewsLetter = () => {
    return (
        <div className='newsletter'>
            <h1>Get Exclusive Offers on Your Email</h1>
            <p>Subcribe to our newsletter and stat updated</p>
            <div>
                <input type='email' placeholder='Your Email id' />
                <button>Subscribe</button>
            </div>
        </div>
    )
}
export default NewsLetter