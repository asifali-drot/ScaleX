import React from 'react'
import './DescriptionBox.css'

 const DescriptionBox = () => {
  return (
    <div className='descriptionbox'>
        <div className='descriptionbox-navigator'>
        <div className='descriptionbox-nav-box'>Description</div> 
        <div className='descriptionbox-nav-box fade'>Reviews (122)</div> 
        </div>
        <div className='descriptionbox-description'>
            <p>Cloth is a material created by weaving, knitting, or felting fibers to form a flexible and durable fabric. It is commonly used for making clothing, upholstery, and other textile products. 
                Cloth can be made from natural fibers like cotton, wool, silk, and linen, which are valued for their comfort and breathability. </p>
       <p>Blended fabrics combine natural and synthetic fibers to enhance specific properties like softness, strength, or stretchability. The type of cloth chosen depends on its intended use, climate suitability, and aesthetic preferences.</p>
        </div>
    </div>
  )
}
export default DescriptionBox
