// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/src/Test.sol";
import "../src/CeramicAnchorServiceV2.sol";

contract CeramicAnchorServiceV2Test is Test {
    CeramicAnchorServiceV2 casv2;
    function setUp() public {
        casv2 = new CeramicAnchorServiceV2();
    }

    function testOwner() public {
        assertEq(casv2.owner(), address(this));
    }

    function testOwnershipChange() public {
        address newOwner = address(1);
        casv2.transferOwnership(newOwner);        
    }

    function testOwnershipChangeFuzz(address newOwner) public {
        vm.assume(newOwner > address(0));
        casv2.transferOwnership(newOwner);        
    }

    function testFailOwnershipChangeToZeroAddress() public {
        vm.expectRevert(stdError.assertionError);
        address newOwner = address(0);
        casv2.transferOwnership(newOwner);        
    }

    function testIfDisallowedServiceIsAllowed() public {
        address testService = address(0);
        assertEq(casv2.isServiceAllowed(testService), false);
    }

    function testIfDisallowedServiceIsAllowedFuzz(address testService) public {
        assertEq(casv2.isServiceAllowed(testService), false);
    }

    function testIfAllowedServiceIsAllowed() public {
        address testService = address(1);
        casv2.addCas(testService);
        assertEq(casv2.isServiceAllowed(testService), true);
    }

    function testIfAllowedServiceIsAllowedFuzz(address testService) public {
        casv2.addCas(testService);
        assertEq(casv2.isServiceAllowed(testService), true);
    }

    function testAddCas() public {
        address service = address(this);
        casv2.addCas(service);
    }

    function testAddCasFuzz(address service) public {
        casv2.addCas(service);
    }

    function testAnchor() public {
        address testService = address(this);
        casv2.addCas(testService);
        casv2.anchor("0x0");
    }

    function testAnchorFuzz(bytes calldata _root) public {
    // function testAnchorFuzz(bytes32 _root1, bytes32 _root2, bytes8 _root3) public {
        address testService = address(this);
        casv2.addCas(testService);
        casv2.anchor(_root);
        // casv2.anchor(_root1, _root2, _root3);
    }

    function testFailAnchorFuzz(bytes calldata _root, address testService) public {
    // function testFailAnchorFuzz(bytes32 _root1, bytes32 _root2, bytes8 _root3) public {
        vm.expectRevert(stdError.assertionError);
        vm.assume(testService != address(this)); 
        casv2.addCas(testService);
        casv2.anchor(_root);
        // casv2.anchor(_root1, _root2, _root3);
    }

}
